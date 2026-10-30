// Dados no aparelho (localStorage) + regra de mescla igual à do PC (sincronizacao.py).
// Formato: { produtos: {uid: registro}, despesas: {...}, parcelas: {...}, exclusoes: {tabela: {uid: ms}} }
// Todo registro tem `u` = momento da última alteração (ms). Na mescla vence o `u` mais novo;
// uma exclusão vence se for mais nova que a última edição.
const TABELAS = ['produtos', 'despesas', 'parcelas'];

function estadoVazio() {
  return { v: 1, produtos: {}, despesas: {}, parcelas: {}, exclusoes: { produtos: {}, despesas: {}, parcelas: {} } };
}

function canonico(rec) {
  const ord = {};
  for (const k of Object.keys(rec).sort()) ord[k] = rec[k];
  return JSON.stringify(ord);
}

function maisNovo(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.u !== b.u) return a.u > b.u ? a : b;
  return canonico(a) >= canonico(b) ? a : b; // empate: escolha determinística (igual ao PC)
}

function mesclar(a, b) {
  const m = estadoVazio();
  for (const t of TABELAS) {
    const ra = a[t] || {}, rb = b[t] || {};
    const ea = a.exclusoes?.[t] || {}, eb = b.exclusoes?.[t] || {};
    const uids = new Set([...Object.keys(ra), ...Object.keys(rb), ...Object.keys(ea), ...Object.keys(eb)]);
    for (const uid of uids) {
      const rec = maisNovo(ra[uid], rb[uid]);
      const excl = Math.max(ea[uid] || 0, eb[uid] || 0);
      if (excl && (!rec || excl >= rec.u)) m.exclusoes[t][uid] = excl;
      else if (rec) m[t][uid] = rec;
    }
  }
  return m;
}

function iguais(a, b) {
  for (const t of TABELAS) {
    const ka = Object.keys(a[t]), kb = Object.keys(b[t]);
    if (ka.length !== kb.length || ka.some((k) => b[t][k]?.u !== a[t][k].u)) return false;
    const xa = Object.keys(a.exclusoes[t]), xb = Object.keys(b.exclusoes[t]);
    if (xa.length !== xb.length || xa.some((k) => b.exclusoes[t][k] !== a.exclusoes[t][k])) return false;
  }
  return true;
}

const Dados = (() => {
  const KEY = 'gestao:dados';
  let db = ler();
  const ouvintes = new Set();
  let lote = 0, sujo = false;

  function ler() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d && d.produtos) return mesclar(estadoVazio(), d);
    } catch { /* dado corrompido: começa vazio e a sincronização repõe */ }
    return estadoVazio();
  }
  function persistir(origem) {
    if (lote) { sujo = origem; return; }
    localStorage.setItem(KEY, JSON.stringify(db));
    for (const fn of ouvintes) fn(origem);
  }
  // Várias gravações seguidas (ex.: cadastro em lote) → salva e avisa uma vez só
  function emLote(fn) {
    lote++;
    try { return fn(); } finally {
      lote--;
      if (!lote && sujo) { const o = sujo; sujo = false; persistir(o); }
    }
  }

  const novoUid = () => crypto.randomUUID().replace(/-/g, '');

  function gravar(tab, uid, campos) {
    uid ||= novoUid();
    const ant = db[tab][uid];
    const u = Math.max(Date.now(), (ant?.u || 0) + 1, (db.exclusoes[tab][uid] || 0) + 1);
    db[tab][uid] = { ...(ant || {}), ...campos, u };
    delete db.exclusoes[tab][uid];
    persistir('local');
    return uid;
  }
  function excluir(tab, uid) {
    const ant = db[tab][uid];
    if (!ant) return;
    delete db[tab][uid];
    db.exclusoes[tab][uid] = Math.max(Date.now(), ant.u + 1);
    persistir('local');
  }
  // Junta o que veio da nuvem com o que está no aparelho (inclusive edições feitas durante o download)
  function receber(remoto) {
    const novo = mesclar(db, remoto);
    if (!iguais(novo, db)) { db = novo; persistir('remoto'); }
    return db;
  }
  function apagarTudo() { db = estadoVazio(); localStorage.removeItem(KEY); for (const fn of ouvintes) fn('remoto'); }

  const lista = (tab) => Object.entries(db[tab]).map(([uid, r]) => ({ ...r, uid }));
  return {
    gravar, excluir, receber, emLote, apagarTudo, novoUid,
    estado: () => db,
    vazio: () => !TABELAS.some((t) => Object.keys(db[t]).length),
    ouvir: (fn) => ouvintes.add(fn),
    produtos: () => lista('produtos'),
    despesas: () => lista('despesas'),
    parcelas: () => lista('parcelas'),
    produto: (uid) => (db.produtos[uid] ? { ...db.produtos[uid], uid } : null),
    despesa: (uid) => (db.despesas[uid] ? { ...db.despesas[uid], uid } : null),
    parcelasDe: (puid) => lista('parcelas').filter((p) => p.produto_uid === puid).sort((a, b) => a.numero - b.numero),
  };
})();

// ─── Regras do negócio (as mesmas telas/consultas do programa do PC) ──────────
const PLATAFORMAS = ['PS3', 'PS4', 'PS5', 'Xbox One S', 'Xbox One X', 'Xbox Series S', 'Xbox Series X', 'Nintendo Switch'];
const ARMAZ = ['8 GB', '16 GB', '32 GB', '64 GB', '128 GB', '256 GB', '512 GB', '1 TB'];
const BATS = Array.from({ length: 51 }, (_, i) => `${100 - i}%`);
const STATUS_ITEM = ['', 'Aguardando venda', 'Chegando', 'Aguardando envio'];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const num = (v) => Number(v) || 0;
const fmtBRL = (v) => num(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
function fmtData(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const mesISO = () => hojeISO().slice(0, 7);
function agoraSQL() { // mesmo formato do CURRENT_TIMESTAMP do SQLite (UTC)
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// Valor em formato brasileiro → número (mesmas regras do _to_float do PC)
function lerValor(s) {
  s = String(s ?? '').trim();
  if (!s) return 0;
  if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.')) || 0;
  const p = s.split('.');
  if (p.length === 2 && p[1].length === 3 && /^\d+$/.test(p[0]) && /^\d+$/.test(p[1])) return Number(s.replace('.', '')) || 0;
  return Number(s) || 0;
}
// número → texto para editar no campo ("3450,9")
const valorCampo = (v) => (num(v) ? String(num(v)).replace('.', ',') : '');

function subCats(p) {
  try { return JSON.parse(p.sub_cats || '[]') || []; } catch { return []; }
}
const NOMES_CAT = { console: 'Console', acessorio: 'Acessório', jogo: 'Jogo', servico: 'Serviço' };
const subTxt = (p) => subCats(p).map((c) => NOMES_CAT[c]).filter(Boolean).join(', ') || '—';

// Nome mostrado nas listas (mesma regra do _nome_produto do PC)
function nomeExibicao(p) {
  if (p.categoria === 'celulares') return p.nome || '—';
  const cats = subCats(p);
  if (cats.includes('servico')) return p.nome || '—'; // o nome salvo já junta tudo (inclui o serviço)
  const temConsole = cats.includes('console') && p.console_nome;
  const temJogo = cats.includes('jogo') && p.jogos_desc;
  const temAcess = cats.includes('acessorio');
  if (temAcess && !temConsole && !temJogo) return p.nome || '—';
  const partes = [];
  if (temConsole) partes.push(p.console_nome);
  if (temAcess) {
    const ac = [];
    if (num(p.ctrl_orig)) ac.push(`${p.ctrl_orig}x Ctrl.Orig`);
    if (num(p.ctrl_para)) ac.push(`${p.ctrl_para}x Ctrl.Para`);
    if (num(p.tem_cabos)) ac.push('Cabos');
    if (ac.length) partes.push(ac.join(', '));
  }
  if (temJogo) partes.push(p.jogos_desc);
  return partes.join(' | ') || p.nome || '—';
}

const custo = (p) => num(p.preco_compra) + num(p.custo_reparo);
const vendido = (p) => num(p.preco_venda) > 0 && !!p.data_venda;
// "Com defeito" (reparo=1): só vai para Em conserto depois de ter data de envio e volta para o
// estoque quando tem data de entrega. Com defeito e sem envio continua no estoque. (Igual ao PC.)
const naListaConserto = (p) => num(p.reparo) === 1 && !p.data_venda && !!p.data_envio_rep && !p.data_entrega_rep;
const naListaEstoque = (p) => !p.data_venda && !naListaConserto(p);
// a etiqueta "Com defeito" só some com "Consertado" marcado (há defeitos que não têm conserto)
const comDefeito = (p) => num(p.reparo) === 1 && !num(p.consertado) && !naListaConserto(p);

function statusProduto(p) {
  if (num(p.preco_venda) && p.data_venda) return ['Vendido', 'vendido'];
  if (p.status_item) return [p.status_item, p.status_item === 'Chegando' ? 'chegando' : 'estoque'];
  if (comDefeito(p)) return ['Com defeito', 'defeito'];
  return ['Estoque', 'estoque'];
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Lucro "de caixa": conta o lucro à medida que o dinheiro entra, recuperando o custo primeiro.
// Ex.: custo R$ 600, venda R$ 1.500 (R$ 400 na hora + fiado): enquanto não entrarem R$ 600 o lucro
// recebido é zero; depois disso cada real que entra é lucro. Venda à vista: lucro todo no dia.
// Devolve { eventos: [{data, categoria, lucro}], aReceber } (aReceber = lucro que falta entrar do fiado).
function lucroRecebido() {
  const parc = new Map();
  for (const x of Dados.parcelas()) {
    if (!parc.has(x.produto_uid)) parc.set(x.produto_uid, []);
    parc.get(x.produto_uid).push(x);
  }
  const eventos = [];
  let aReceber = 0;
  for (const p of Dados.produtos()) {
    if (!vendido(p)) continue;
    const c = custo(p), pv = num(p.preco_venda), fiado = num(p.pag_fiado) === 1;
    const ps = fiado ? (parc.get(p.uid) || []) : [];
    const fiadoTotal = ps.length ? ps.reduce((t, x) => t + num(x.valor), 0) : (fiado ? num(p.val_fiado) : 0);
    const entradas = [[p.data_venda, Math.max(pv - fiadoTotal, 0)],
      ...ps.filter((x) => num(x.pago)).map((x) => [x.data_pagamento || x.vencimento || p.data_venda, num(x.valor)])]
      .sort((a, b) => a[0].localeCompare(b[0]));
    const quitado = !fiado || (ps.length > 0 && ps.every((x) => num(x.pago)));
    let recebido = 0, reconhecido = 0;
    entradas.forEach(([d, v], i) => {
      recebido += v;
      const novo = recebido >= c || (i === entradas.length - 1 && quitado) ? recebido - c : 0;
      if (Math.abs(novo - reconhecido) > 0.004) { eventos.push({ data: d, categoria: p.categoria, lucro: novo - reconhecido }); reconhecido = novo; }
    });
    if (!quitado) aReceber += (pv - c) - reconhecido;
  }
  return { eventos, aReceber };
}

// Em qual parcela do fiado o lucro começa — o custo volta primeiro, parcelas na ordem do número.
// (Mesma regra do PC: ponto_lucro.) n = 0: já na entrada; n = null: venda no prejuízo.
function pontoLucro(p) {
  const c = custo(p), pv = num(p.preco_venda);
  const ps = Dados.parcelasDe(p.uid);
  const fiadoTotal = ps.length ? ps.reduce((t, x) => t + num(x.valor), 0) : num(p.val_fiado);
  const entrada = Math.max(pv - fiadoTotal, 0);
  let n = null, vencimento = '', lucroNa = 0;
  if (entrada >= c - 0.004) { n = 0; lucroNa = entrada - c; } else {
    let acum = entrada;
    for (const x of ps) {
      acum += num(x.valor);
      if (acum >= c - 0.004) { n = x.numero; vencimento = x.vencimento || ''; lucroNa = acum - c; break; }
    }
  }
  const recebido = entrada + ps.filter((x) => num(x.pago)).reduce((t, x) => t + num(x.valor), 0);
  return { n, vencimento, lucroNa, lucrando: recebido >= c - 0.004, faltaCusto: Math.max(c - recebido, 0), recebido,
    pagas: ps.filter((x) => num(x.pago)).length, totalParcelas: ps.length };
}
// vendas no fiado com parcela em aberto
const vendasFiadoAbertas = () => Dados.produtos().filter((p) => vendido(p) && num(p.pag_fiado) === 1
  && !(Dados.parcelasDe(p.uid).length && Dados.parcelasDe(p.uid).every((x) => num(x.pago))));

// { numero: [lucro que entra nesta parcela, lucro acumulado até ela] } — só das parcelas que trazem lucro.
// (Mesma regra do PC: lucro_por_parcela.)
function lucroPorParcela(p) {
  const c = custo(p), pv = num(p.preco_venda), ps = Dados.parcelasDe(p.uid);
  const fiadoTotal = ps.length ? ps.reduce((t, x) => t + num(x.valor), 0) : num(p.val_fiado);
  let acum = Math.max(pv - fiadoTotal, 0), antes = Math.max(acum - c, 0);
  const saida = {};
  for (const x of ps) {
    acum += num(x.valor);
    const ate = Math.max(acum - c, 0);
    if (ate - antes > 0.004) saida[x.numero] = [ate - antes, ate];
    antes = ate;
  }
  return saida;
}
