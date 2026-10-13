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
const PLATAFORMAS = ['PS3', 'PS4', 'PS5', 'Xbox One S', 'Xbox Series S', 'Xbox Series X', 'Nintendo Switch'];
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
const NOMES_CAT = { console: 'Console', acessorio: 'Acessório', jogo: 'Jogo' };
const subTxt = (p) => subCats(p).map((c) => NOMES_CAT[c]).filter(Boolean).join(', ') || '—';

// Nome mostrado nas listas (mesma regra do _nome_produto do PC)
function nomeExibicao(p) {
  if (p.categoria === 'celulares') return p.nome || '—';
  const cats = subCats(p);
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
const naListaEstoque = (p) => !p.data_venda && (!num(p.reparo) || (num(p.reparo) === 1 && !!p.data_entrega_rep));
const naListaConserto = (p) => num(p.reparo) === 1 && !p.data_venda && !p.data_entrega_rep;

function statusProduto(p) {
  if (num(p.preco_venda) && p.data_venda) return ['Vendido', 'vendido'];
  if (p.status_item) return [p.status_item, p.status_item === 'Chegando' ? 'chegando' : 'estoque'];
  if (num(p.reparo)) return ['Conserto', 'conserto'];
  return ['Estoque', 'estoque'];
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
