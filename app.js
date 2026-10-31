// Gestão de Vendas — celular. Telas: início (dashboard), estoque/vendas/conserto, produto,
// cadastro/edição (com lote e venda), despesas, fiado, clientes e configuração.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const tela = $('#tela');
let formAberto = false;
let ultimaRota = '';

const pref = {
  get cat() { return localStorage.getItem('gestao:cat') || 'games'; },
  set cat(c) { localStorage.setItem('gestao:cat', c); },
};

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('visivel');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visivel'), 2800);
}

function rota() {
  const h = location.hash.replace(/^#/, '') || '/inicio';
  const [caminho, qs] = h.split('?');
  return { partes: caminho.split('/').filter(Boolean).map(decodeURIComponent), q: new URLSearchParams(qs || ''), chave: h };
}
// quantas telas foram abertas dentro do app — "voltar" só usa o histórico se houver para onde voltar
let profundidade = 0, voltando = false;
window.addEventListener('hashchange', () => { if (voltando) { voltando = false; profundidade = Math.max(0, profundidade - 1); } else profundidade++; });
const ir = (hash) => { location.hash = hash; };
function voltar(padrao = '#/inicio') {
  if (profundidade > 0) { voltando = true; history.back(); } else ir(padrao);
}

function titulo(t, comVoltar = false) {
  $('#titulo').textContent = t;
  $('#voltar').hidden = !comVoltar;
  document.title = `${t} — Gestão`;
}
$('#voltar').addEventListener('click', () => voltar());
$('#pillSync').addEventListener('click', () => ir('#/config'));

const soma = (lista, f) => lista.reduce((s, x) => s + f(x), 0);
const cls = (v) => (v >= 0 ? 'pos' : 'neg');

function kpi(rotulo, valor, { nota = '', href = '', cor = 'var(--borda)', corValor = '' } = {}) {
  const estilo = `--cor:${cor};${corValor ? `--valor:${corValor}` : ''}`;
  return `<a class="kpi" ${href ? `href="${href}"` : ''} style="${estilo}"><small>${esc(rotulo)}</small><b>${esc(valor)}</b>${nota ? `<small>${esc(nota)}</small>` : ''}</a>`;
}

// ─── Roteamento ────────────────────────────────────────────────────────────
function render() {
  if (location.hash.startsWith('#cfg=')) return receberLinkConfig(location.hash);
  const r = rota();
  const mesma = r.chave === ultimaRota;
  const y = tela.scrollTop;
  ultimaRota = r.chave;
  formAberto = false;
  const [v, a] = r.partes;
  const aba = v === 'lista' ? (a || 'compras') : v === 'inicio' || !v ? 'inicio' : ['produto', 'form'].includes(v) ? null : 'mais';
  if (aba) $$('.abas a').forEach((el) => el.classList.toggle('ativa', el.dataset.aba === aba));
  const telas = { inicio: vInicio, lista: vLista, produto: vProduto, form: vForm, despesas: vDespesas,
    despesa: vDespesa, fiado: vFiado, clientes: vClientes, cliente: vCliente, mais: vMais, config: vConfig,
    'lucro-fiado': vLucroFiado };
  (telas[v] || vInicio)(r);
  tela.scrollTo(0, mesma ? y : 0);
}
window.addEventListener('hashchange', render);

// dados novos vindos do PC: redesenha a tela (menos se houver um formulário sendo preenchido)
Dados.ouvir((origem) => {
  if (origem !== 'remoto') return;
  if (formAberto) toast('Chegaram alterações do PC');
  else render();
});

// ─── Indicador de sincronização ─────────────────────────────────────────────
function hhmm(ms) { return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
function atualizarPill(e = Sync.estado) {
  const pill = $('#pillSync');
  pill.className = `pill ${e.status}`;
  const txt = { desligado: 'Conectar', sincronizando: 'Sincronizando', ok: 'Sincronizado', erro: navigator.onLine ? 'Erro' : 'Offline' }[e.status];
  pill.querySelector('span').textContent = txt;
  pill.title = e.status === 'erro' ? e.erro : e.ultima ? `Última sincronização ${hhmm(e.ultima)}` : '';
  if (ultimaRota.startsWith('/config') && !formAberto) vConfig(rota());
}
Sync.ouvir(atualizarPill);

// ─── Início (dashboard) ─────────────────────────────────────────────────────
function cartaoConectar() {
  return `<div class="card pad">
    <div class="det-titulo">📱 Conectar ao PC</div>
    <p class="sub">Os produtos, vendas, despesas e o fiado vêm do programa do PC, criptografados.</p>
    <ol class="passos">
      <li>No PC, abra a <b>Gestão de Vendas</b> e clique em <b>📱 Celular</b> (no menu de cima).</li>
      <li>Clique em <b>Conectar um celular</b> para ver o QR code.</li>
      <li>Aqui, toque em <b>Configurar</b> e leia o QR com a câmera. Depois digite a senha da sincronização.</li>
    </ol>
    <div class="acoes"><a class="btn prim" href="#/config">Configurar</a></div>
  </div>`;
}

function vInicio() {
  titulo('Gestão de Vendas');
  if (!Sync.configurado() && Dados.vazio()) { tela.innerHTML = cartaoConectar(); return; }
  const P = Dados.produtos(), hoje = hojeISO(), mes = mesISO();
  const semVenda = (p) => !p.data_venda;

  const parado = (cat) => {
    const est = P.filter((p) => p.categoria === cat && naListaEstoque(p)); // inclui os que voltaram do conserto
    const con = P.filter((p) => p.categoria === cat && naListaConserto(p));
    return { nEst: est.length, vEst: soma(est, custo), nCon: con.length, vCon: soma(con, custo) };
  };
  const vendas = (cat, filtro) => {
    const v = P.filter((p) => p.categoria === cat && vendido(p) && filtro(p.data_venda));
    return { n: v.length, fat: soma(v, (p) => num(p.preco_venda)), lucro: soma(v, (p) => num(p.preco_venda) - custo(p)) };
  };
  const pg = parado('games'), pi = parado('celulares');

  const linhaVendas = (rotulo, x, href) => `<a class="vendas-linha" href="${href}">
      <span>${rotulo}</span>
      <span><small>Vendidos</small><b>${x.n}</b></span>
      <span><small>Faturamento</small><b>${fmtBRL(x.fat)}</b></span>
      <span><small>Lucro</small><b class="${cls(x.lucro)}">${fmtBRL(x.lucro)}</b></span></a>`;
  const blocoVendas = (cat, nome) => `<div class="vendas-cab">${nome}</div>
      ${linhaVendas('Mês', vendas(cat, (d) => d.startsWith(mes)), `#/lista/vendas?cat=${cat}&periodo=mes`)}
      ${linhaVendas('Hoje', vendas(cat, (d) => d === hoje), `#/lista/vendas?cat=${cat}&periodo=dia`)}`;

  const parcAbertas = Dados.parcelas().filter((x) => !num(x.pago));
  const atrasadas = parcAbertas.filter((x) => x.vencimento && x.vencimento < hoje).length;
  const D = Dados.despesas();
  const despMes = soma(D.filter((d) => (d.data || '').startsWith(mes)), (d) => num(d.valor));
  const despHoje = soma(D.filter((d) => d.data === hoje), (d) => num(d.valor));
  const despMesForma = (f) => soma(D.filter((d) => (d.data || '').startsWith(mes) && d.forma_pagamento === f), (d) => num(d.valor));
  const lr = lucroRecebido();
  const clientes = new Set(P.filter((p) => (p.nome_comprador || '').trim() && p.data_venda).map((p) => p.nome_comprador.trim())).size;

  // estoque por plataforma / modelo (mesmas regras da dashboard do PC)
  const reparoOk = (p) => !naListaConserto(p);
  const agrupar = (lista, chave) => {
    const m = new Map();
    for (const p of lista) m.set(chave(p), (m.get(chave(p)) || 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };
  const consoles = P.filter((p) => p.categoria === 'games' && semVenda(p) && (p.sub_cats || '').includes('console') && p.plataforma);
  // prontos para venda: com defeito (sem "Consertado") não entra
  const platEst = agrupar(consoles.filter((p) => reparoOk(p) && !comDefeito(p) && p.status_item === 'Aguardando venda'), (p) => p.plataforma);
  const platCheg = agrupar(consoles.filter((p) => p.status_item === 'Chegando'), (p) => p.plataforma);
  const iph = P.filter((p) => p.categoria === 'celulares' && semVenda(p));
  const iphEst = agrupar(iph.filter((p) => reparoOk(p) && !comDefeito(p) && p.status_item === 'Aguardando venda'), (p) => p.nome);
  const iphCheg = agrupar(iph.filter((p) => p.status_item === 'Chegando'), (p) => p.nome);
  const chips = (lista, href, chegando, vazio) => (lista.length
    ? `<div class="chips">${lista.map(([nome, n]) => `<a class="chip ${chegando ? 'chegando' : n < 2 ? 'baixo' : ''}" href="${href(nome)}">
        ${esc(nome)}<b>${n}</b>${chegando ? '<span class="nota">🚚 A caminho</span>' : n < 2 ? '<span class="nota">⚠ Baixo</span>' : ''}</a>`).join('')}</div>`
    : `<div class="sub">${vazio}</div>`);
  const hrefPlat = (p) => `#/lista/compras?cat=games&plat=${encodeURIComponent(p)}`;
  const hrefIph = (n) => `#/lista/compras?cat=celulares&nome=${encodeURIComponent(n)}`;

  tela.innerHTML = `
    ${Sync.configurado() ? '' : `<div class="aviso">Este aparelho não está sincronizando. <a href="#/config">Configurar</a></div>`}
    <div class="secao" style="--cor:var(--amb)">💰 Dinheiro parado</div>
    <div class="grade">
      ${kpi('Games em estoque', fmtBRL(pg.vEst), { nota: `${pg.nEst} itens`, href: '#/lista/compras?cat=games', cor: 'var(--amb)' })}
      ${kpi('Games em conserto', fmtBRL(pg.vCon), { nota: `${pg.nCon} itens`, href: '#/lista/conserto?cat=games', cor: 'var(--verm)' })}
      ${kpi('iPhones em estoque', fmtBRL(pi.vEst), { nota: `${pi.nEst} itens`, href: '#/lista/compras?cat=celulares', cor: 'var(--ciano)' })}
      ${kpi('iPhones em conserto', fmtBRL(pi.vCon), { nota: `${pi.nCon} itens`, href: '#/lista/conserto?cat=celulares', cor: 'var(--verm)' })}
      ${kpi('Total games', fmtBRL(pg.vEst + pg.vCon), { href: '#/lista/compras?cat=games', cor: 'var(--amb)' })}
      ${kpi('Total iPhones', fmtBRL(pi.vEst + pi.vCon), { href: '#/lista/compras?cat=celulares', cor: 'var(--ciano)' })}
    </div>

    <div class="secao" style="--cor:var(--verde)">🛒 Vendas</div>
    <div class="card">${blocoVendas('games', '🎮 Games')}${blocoVendas('celulares', '📱 iPhones')}</div>

    <div class="secao" style="--cor:var(--roxo)">🧾 Financeiro</div>
    <div class="grade">
      ${kpi('Fiado a receber', fmtBRL(soma(parcAbertas, (x) => num(x.valor))), { nota: `${parcAbertas.length} parcela(s)${atrasadas ? ` · ${atrasadas} atrasada(s)` : ''}`, href: '#/fiado', cor: atrasadas ? 'var(--verm)' : 'var(--amb)' })}
      ${kpi('Clientes', `${clientes}`, { nota: 'ver lista', href: '#/clientes', cor: 'var(--roxo)' })}
      ${kpi('Despesas do mês', fmtBRL(despMes), { nota: `hoje ${fmtBRL(despHoje)}`, href: '#/despesas', cor: 'var(--verm)', corValor: 'var(--verm)' })}
      ${kpi('Nova despesa', '+ Lançar', { href: '#/despesa/nova', cor: 'var(--borda)' })}
      ${kpi('💚 Pix no mês', fmtBRL(despMesForma('Pix')), { nota: 'despesas', href: '#/despesas', cor: 'var(--verde)' })}
      ${kpi('💳 Cartão no mês', fmtBRL(despMesForma('Cartão')), { nota: 'despesas', href: '#/despesas', cor: 'var(--azul)' })}
      ${kpi('Faturamento a receber', fmtBRL(soma(parcAbertas, (x) => num(x.valor))), { nota: 'do fiado', href: '#/lucro-fiado', cor: 'var(--ciano)' })}
      ${kpi('Lucro a receber', fmtBRL(lr.aReceber), { nota: 'do fiado — toque para ver as parcelas', href: '#/lucro-fiado', cor: 'var(--amb)' })}
    </div>

    <div class="secao" style="--cor:var(--azul)">📦 Estoque</div>
    <div class="card pad">
      <div class="sub" style="margin-bottom:6px">Consoles prontos para venda (vermelho = menos de 2; com defeito não entra)</div>
      ${chips(platEst, hrefPlat, false, 'Nenhum console aguardando venda')}
      ${platCheg.length ? `<div class="sub" style="margin:12px 0 6px">Consoles chegando</div>${chips(platCheg, hrefPlat, true)}` : ''}
      <div class="sub" style="margin:14px 0 6px">iPhones prontos para venda</div>
      ${chips(iphEst, hrefIph, false, 'Nenhum iPhone aguardando venda')}
      ${iphCheg.length ? `<div class="sub" style="margin:12px 0 6px">iPhones chegando</div>${chips(iphCheg, hrefIph, true)}` : ''}
    </div>`;
}

// ─── Listas (estoque / vendas / conserto) ───────────────────────────────────
const NOMES_MODO = { compras: 'Estoque', vendas: 'Vendas', conserto: 'Em conserto' };
let filtroLista = { chave: '', busca: '', fcat: 'Todos', fplat: 'Todas' };

function vLista(r) {
  const modo = NOMES_MODO[r.partes[1]] ? r.partes[1] : 'compras';
  if (r.q.get('cat')) pref.cat = r.q.get('cat');
  const cat = pref.cat;
  const periodo = r.q.get('periodo') || '';
  const plat = r.q.get('plat') || '';
  const nomeFiltro = r.q.get('nome') || '';
  if (filtroLista.chave !== r.chave) {
    filtroLista = { chave: r.chave, busca: '', fcat: plat ? 'Console' : 'Todos', fplat: plat || 'Todas' };
  }
  const sufixo = { mes: ' — mês', dia: ' — hoje' }[periodo] || '';
  titulo(`${NOMES_MODO[modo]}${sufixo}`);

  const href = (c, per = periodo) => `#/lista/${modo}?cat=${c}${per ? `&periodo=${per}` : ''}`;
  const games = cat === 'games';
  tela.innerHTML = `
    <div class="segmento">
      <button type="button" class="${games ? 'ativo' : ''}" data-ir="${href('games')}">🎮 Games</button>
      <button type="button" class="${!games ? 'ativo' : ''}" data-ir="${href('celulares')}">📱 Celulares</button>
    </div>
    ${modo === 'vendas' ? `<div class="segmento" style="margin-top:8px">
      ${[['', 'Todas'], ['mes', 'Mês atual'], ['dia', 'Hoje']].map(([p, t]) => `<button type="button" class="${periodo === p ? 'ativo' : ''}" data-ir="${href(cat, p)}">${t}</button>`).join('')}
    </div>` : ''}
    ${nomeFiltro ? `<div class="aviso">Mostrando só: <b>${esc(nomeFiltro)}</b> · <a href="${href(cat)}">ver todos</a></div>` : ''}
    <div class="filtros">
      ${games ? `<select id="fcat" aria-label="Categoria">${['Todos', 'Console', 'Acessório', 'Jogo', 'Serviço'].map((o) => `<option ${o === filtroLista.fcat ? 'selected' : ''}>${o}</option>`).join('')}</select>
      <select id="fplat" aria-label="Plataforma">${['Todas', ...PLATAFORMAS].map((o) => `<option ${o === filtroLista.fplat ? 'selected' : ''}>${o}</option>`).join('')}</select>` : ''}
      <div class="busca"><input type="search" id="busca" placeholder="Buscar" value="${esc(filtroLista.busca)}" autocomplete="off"></div>
    </div>
    <div id="metricas" class="metricas"></div>
    <div id="contador" class="contador"></div>
    <div id="itens" class="itens"></div>
    ${modo === 'compras' ? `<button type="button" class="fab" aria-label="Adicionar produto" data-ir="#/form/novo?cat=${cat}">+</button>` : ''}`;

  $$('[data-ir]', tela).forEach((b) => b.addEventListener('click', () => ir(b.dataset.ir)));
  const atualizar = () => listarItens(modo, cat, periodo, nomeFiltro);
  $('#busca').addEventListener('input', (e) => { filtroLista.busca = e.target.value; atualizar(); });
  $('#fcat')?.addEventListener('change', (e) => { filtroLista.fcat = e.target.value; atualizar(); });
  $('#fplat')?.addEventListener('change', (e) => { filtroLista.fplat = e.target.value; atualizar(); });
  atualizar();
}

function textoBusca(p) {
  return [nomeExibicao(p), p.nome, p.plataforma, subTxt(p), p.armazenamento, p.saude_bateria, fmtData(p.data_compra),
    fmtData(p.data_venda), statusProduto(p)[0], p.nome_comprador, p.tel_comprador, p.observacoes, p.num_serie,
    fmtBRL(p.preco_compra), fmtBRL(p.preco_venda)].join(' ').toLowerCase();
}

function listarItens(modo, cat, periodo, nomeFiltro) {
  let base = Dados.produtos().filter((p) => p.categoria === cat);
  if (modo === 'compras') base = base.filter(naListaEstoque).sort((a, b) => (b.data_compra || '').localeCompare(a.data_compra || ''));
  else if (modo === 'vendas') {
    base = base.filter(vendido);
    if (periodo === 'mes') base = base.filter((p) => p.data_venda.startsWith(mesISO()));
    if (periodo === 'dia') base = base.filter((p) => p.data_venda === hojeISO());
    base.sort((a, b) => (b.data_venda || '').localeCompare(a.data_venda || ''));
  } else base = base.filter(naListaConserto).sort((a, b) => (b.data_compra || '').localeCompare(a.data_compra || ''));

  const { busca, fcat, fplat } = filtroLista;
  const mapa = { Console: 'console', Acessório: 'acessorio', Jogo: 'jogo', Serviço: 'servico' };
  const termo = busca.trim().toLowerCase();
  const itens = base.filter((p) => {
    if (cat === 'games' && fcat !== 'Todos' && !subCats(p).includes(mapa[fcat])) return false;
    if (cat === 'games' && fplat !== 'Todas' && p.plataforma !== fplat) return false;
    if (nomeFiltro && p.nome !== nomeFiltro) return false;
    return !termo || textoBusca(p).includes(termo);
  });

  // métricas (sobre o que está na tela)
  const m = (rot, val, cor = '', inv = false) => `<div class="${inv ? 'inv' : ''}" ${cor ? `style="--valor:${cor}"` : ''}><small>${rot}</small><b>${val}</b></div>`;
  let met;
  if (modo === 'compras') {
    const comPrevisto = itens.filter((p) => num(p.preco_venda) || num(p.preco_previsto));
    const luc = soma(comPrevisto, (p) => (num(p.preco_venda) || num(p.preco_previsto)) - custo(p));
    met = m('Itens', itens.length) + m('Capital investido', fmtBRL(soma(itens, custo)), 'var(--amb)')
      + m(comPrevisto.length === itens.length ? 'Lucro previsto' : `Lucro previsto (${comPrevisto.length} de ${itens.length})`,
        comPrevisto.length ? fmtBRL(luc) : '—', luc >= 0 ? 'var(--verde)' : 'var(--verm)');
    if (cat === 'games') {
      const cats = itens.map((p) => [p, subCats(p)]);
      met += m('Consoles', cats.filter(([, c]) => c.includes('console')).length, '', true)
        + m('Ctrl. originais', soma(cats.filter(([, c]) => c.includes('acessorio')), ([p]) => num(p.ctrl_orig)), '', true)
        + m('Ctrl. paralelos', soma(cats.filter(([, c]) => c.includes('acessorio')), ([p]) => num(p.ctrl_para)), '', true)
        + m('Jogos', soma(cats.filter(([, c]) => c.includes('jogo')), ([p]) => (p.jogos_desc || '').split(',').filter((x) => x.trim()).length), '', true);
    }
  } else if (modo === 'vendas') {
    const luc = soma(itens, (p) => num(p.preco_venda) - custo(p));
    met = m('Vendidos', itens.length, 'var(--verde)') + m('Faturado', fmtBRL(soma(itens, (p) => num(p.preco_venda))), 'var(--verde)')
      + m('Lucro', fmtBRL(luc), luc >= 0 ? 'var(--verde)' : 'var(--verm)');
  } else {
    met = m('Em conserto', itens.length, 'var(--amb)') + m('Custo produtos', fmtBRL(soma(itens, (p) => num(p.preco_compra))), 'var(--amb)')
      + m('Custo reparos', fmtBRL(soma(itens, (p) => num(p.custo_reparo))), 'var(--verm)');
  }
  $('#metricas').innerHTML = met;
  $('#contador').textContent = itens.length === base.length ? `${itens.length} item(ns)` : `${itens.length} de ${base.length} item(ns)`;

  const detalhe = (p) => (p.categoria === 'celulares'
    ? [p.armazenamento, p.saude_bateria && `bateria ${p.saude_bateria}`].filter(Boolean).join(' · ')
    : [p.plataforma, subTxt(p) !== '—' && subTxt(p)].filter(Boolean).join(' · '));
  $('#itens').innerHTML = itens.length ? itens.map((p) => {
    const [st, stCls] = statusProduto(p);
    let linhas;
    if (modo === 'vendas') {
      const luc = num(p.preco_venda) - custo(p);
      linhas = `<div class="linha"><span>Vendido ${fmtData(p.data_venda)}</span><span>por <b>${fmtBRL(p.preco_venda)}</b></span><span>lucro <b class="${cls(luc)}">${fmtBRL(luc)}</b></span></div>
        ${p.nome_comprador ? `<div class="linha"><span>🧑 ${esc(p.nome_comprador)}</span>${p.tel_comprador ? `<span>${esc(p.tel_comprador)}</span>` : ''}</div>` : ''}`;
    } else if (modo === 'conserto') {
      linhas = `<div class="linha"><span>Compra <b>${fmtBRL(p.preco_compra)}</b></span>${num(p.custo_reparo) ? `<span>conserto <b>${fmtBRL(p.custo_reparo)}</b></span>` : ''}${p.data_envio_rep ? `<span>enviado ${fmtData(p.data_envio_rep)}</span>` : ''}</div>
        ${p.observacoes ? `<div class="linha"><span>${esc(p.observacoes)}</span></div>` : ''}`;
    } else {
      const pv = num(p.preco_venda), pp = num(p.preco_previsto);
      linhas = `<div class="linha"><span>${fmtData(p.data_compra)}</span><span>compra <b>${fmtBRL(custo(p))}</b></span>${pv ? `<span>venda <b>${fmtBRL(pv)}</b></span><span>lucro <b class="${cls(pv - custo(p))}">${fmtBRL(pv - custo(p))}</b></span>`
        : pp ? `<span>previsto <b>${fmtBRL(pp)}</b></span><span>lucro prev. <b class="${cls(pp - custo(p))}">${fmtBRL(pp - custo(p))}</b></span>` : ''}</div>`;
    }
    return `<a class="card item" href="#/produto/${p.uid}">
      <div class="item-topo"><span class="item-nome">${esc(nomeExibicao(p))}</span>${modo === 'compras' ? `<span class="tags"><span class="tag ${stCls}">${esc(st)}</span>${stCls !== 'defeito' && comDefeito(p) ? '<span class="tag defeito">⚠ Com defeito</span>' : ''}</span>` : ''}</div>
      ${detalhe(p) ? `<div class="linha"><span>${esc(detalhe(p))}</span></div>` : ''}
      ${linhas}</a>`;
  }).join('') : `<div class="vazio">${base.length ? 'Nada encontrado com esses filtros.' : 'Nenhum item aqui.'}</div>`;
}

// ─── Detalhes do produto ────────────────────────────────────────────────────
function linhaDet(rotulo, valor, classe = '') {
  if (valor === null || valor === undefined || valor === '' || valor === '—') return '';
  return `<div class="det-l"><span>${esc(rotulo)}</span><b class="${classe}">${valor}</b></div>`;
}

function vProduto(r) {
  const p = Dados.produto(r.partes[1]);
  titulo('Produto', true);
  if (!p) { tela.innerHTML = '<div class="vazio">Produto não encontrado — pode ter sido excluído.</div>'; return; }
  const cats = subCats(p), eCel = p.categoria === 'celulares';
  const [st, stCls] = statusProduto(p);
  const pv = num(p.preco_venda), luc = pv - custo(p);
  const margem = custo(p) ? (luc / custo(p)) * 100 : 0;
  const acess = [num(p.ctrl_orig) && `${p.ctrl_orig}x orig.`, num(p.ctrl_para) && `${p.ctrl_para}x paralelo`, num(p.tem_cabos) && 'Cabos'].filter(Boolean).join(', ');
  const quem = (k) => {
    const t = p[`rec_${k}_tipo`], n = p[`rec_${k}_nome`];
    return t ? ` <span class="sub">(${esc(t === 'Dinheiro' || !n ? t : `${t} — ${n}`)})</span>` : '';
  };
  const pags = [
    num(p.pag_cartao) && `💳 Cartão${num(p.val_cartao) ? ` ${fmtBRL(p.val_cartao)}` : ''}${quem('cartao')}`,
    num(p.pag_pix) && `💚 Pix${num(p.val_pix) ? ` ${fmtBRL(p.val_pix)}` : ''}${quem('pix')}`,
    num(p.pag_dinheiro) && `💵 Dinheiro${num(p.val_dinheiro) ? ` ${fmtBRL(p.val_dinheiro)}` : ''}`,
    num(p.pag_fiado) && `🧾 Fiado${num(p.val_fiado) ? ` ${fmtBRL(p.val_fiado)}` : ''}${quem('fiado')}`,
  ].filter(Boolean).join('<br>');
  // venda antiga, sem recebedor por forma de pagamento: mostra o recebedor único de antes
  const recebido = p.recebedor_tipo && !['cartao', 'pix', 'fiado'].some((k) => p[`rec_${k}_tipo`])
    ? (p.recebedor_tipo === 'Dinheiro' || !p.recebedor_nome ? p.recebedor_tipo : `${p.recebedor_tipo} — ${p.recebedor_nome}`) : '';
  const tel = (p.tel_comprador || '').replace(/\D/g, '');
  const parcelas = Dados.parcelasDe(p.uid);
  const hoje = hojeISO();
  const temComprador = p.nome_comprador || p.tel_comprador || pags;

  tela.innerHTML = `
    <div class="det-titulo">${esc(nomeExibicao(p))}</div>
    <div class="sub">${eCel ? '📱 Celulares' : '🎮 Games'} · <span class="tag ${stCls}">${esc(st)}</span>${stCls !== 'defeito' && comDefeito(p) ? ' <span class="tag defeito">⚠ Com defeito</span>' : ''}</div>

    <div class="secao" style="--cor:var(--azul)">📦 Produto</div>
    <div class="card det">
      ${eCel ? '' : linhaDet('Plataforma', esc(p.plataforma))}
      ${eCel ? '' : linhaDet('Nº de série', esc(p.num_serie))}
      ${!eCel && cats.includes('console') ? linhaDet('Console', esc(p.console_nome || p.plataforma)) : ''}
      ${!eCel && cats.includes('acessorio') ? linhaDet('Acessórios', esc(acess)) : ''}
      ${!eCel && cats.includes('jogo') ? linhaDet('Jogos', esc(p.jogos_desc)) : ''}
      ${!eCel && cats.includes('servico') ? linhaDet('Serviço', esc(p.servico_desc || 'Sim')) : ''}
      ${eCel ? linhaDet('Armazenamento', esc(p.armazenamento)) + linhaDet('Saúde da bateria', esc(p.saude_bateria)) : ''}
      ${linhaDet('Status', esc(p.status_item))}
      ${linhaDet('Observações', esc(p.observacoes))}
      ${linhaDet('Categorias', eCel ? '' : esc(subTxt(p)))}
    </div>

    <div class="secao" style="--cor:var(--amb)">💰 Financeiro</div>
    <div class="card det">
      ${linhaDet('Data da compra', fmtData(p.data_compra))}
      ${linhaDet('Preço de compra', fmtBRL(p.preco_compra), 'forte')}
      ${num(p.reparo) ? linhaDet('Custo do conserto', fmtBRL(p.custo_reparo)) : ''}
      ${!p.data_venda && num(p.preco_previsto) ? linhaDet('Preço previsto de venda', fmtBRL(p.preco_previsto)) + linhaDet('Lucro previsto', fmtBRL(num(p.preco_previsto) - custo(p)), cls(num(p.preco_previsto) - custo(p))) : ''}
      ${linhaDet('Data da venda', fmtData(p.data_venda))}
      ${pv ? linhaDet('Preço de venda', fmtBRL(pv), 'forte pos') : ''}
      ${pv ? linhaDet('Lucro', fmtBRL(luc), `forte ${cls(luc)}`) : ''}
      ${pv ? linhaDet('Margem', `${margem.toFixed(1).replace('.', ',')}%`, cls(luc)) : ''}
    </div>

    ${blocoTroca(p, luc)}

    ${temComprador ? `<div class="secao" style="--cor:var(--verde)">🧑 Comprador</div>
    <div class="card det">
      ${linhaDet('Nome', p.nome_comprador ? `<a href="#/cliente?nome=${encodeURIComponent(p.nome_comprador.trim())}">${esc(p.nome_comprador)}</a>` : '')}
      ${linhaDet('Telefone', tel ? `<a href="https://wa.me/${tel.length <= 11 ? '55' : ''}${tel}" target="_blank" rel="noopener">${esc(p.tel_comprador)}</a>` : esc(p.tel_comprador))}
      ${linhaDet('Recebido por', esc(recebido))}
      ${linhaDet('Pagamento', pags)}
    </div>` : ''}

    ${parcelas.length ? `<div class="secao" style="--cor:var(--verm)">🧾 Parcelas (fiado)</div>
    <div class="card">
      <div class="parcela"><div class="info"><b>${parcelas.filter((x) => num(x.pago)).length} de ${parcelas.length} pagas</b></div>
        <b class="${soma(parcelas.filter((x) => !num(x.pago)), (x) => num(x.valor)) > 0 ? 'neg' : 'pos'}">Restante ${fmtBRL(soma(parcelas.filter((x) => !num(x.pago)), (x) => num(x.valor)))}</b></div>
      ${(() => {
        const pl = pontoLucro(p);
        if (!pl.n) return '';
        return `<div class="parcela"><div class="info pos">${pl.lucrando ? `💰 Já lucrando desde a ${pl.n}ª parcela`
          : `💰 O lucro começa na ${pl.n}ª parcela (entram ${fmtBRL(pl.lucroNa)} de lucro nela) — falta cobrir ${fmtBRL(pl.faltaCusto)} do custo`}</div></div>`;
      })()}
      ${parcelas.map((x) => {
        const atras = !num(x.pago) && x.vencimento && x.vencimento < hoje;
        const stp = num(x.pago) ? `✅ Paga${x.data_pagamento ? ` em ${fmtData(x.data_pagamento)}` : ''}` : atras ? '⚠ Atrasada' : '⏳ Pendente';
        return `<div class="parcela"><div class="info"><b>${x.numero}ª · ${fmtBRL(x.valor)}</b>
          <small>${x.vencimento ? `Venc. ${fmtData(x.vencimento)} · ` : ''}<span class="${num(x.pago) ? 'pos' : atras ? 'neg' : ''}">${stp}</span></small>${(() => { const lp = lucroPorParcela(p)[x.numero]; return lp ? `<small class="pos">💰 ${x.numero === pontoLucro(p).n ? 'O lucro começa aqui: ' : ''}+${fmtBRL(lp[0])} de lucro · até aqui ${fmtBRL(lp[1])}</small>` : ''; })()}</div>
          <button type="button" class="btn peq" data-parcela="${x.uid}">${num(x.pago) ? 'Desfazer' : 'Marcar paga'}</button></div>`;
      }).join('')}
    </div>` : ''}

    ${num(p.reparo) ? `<div class="secao" style="--cor:var(--amb)">🔧 Conserto</div>
    <div class="card det">
      ${linhaDet('Custo do conserto', fmtBRL(p.custo_reparo))}
      ${linhaDet('Enviado em', fmtData(p.data_envio_rep))}
      ${linhaDet('Entregue em', fmtData(p.data_entrega_rep))}
      ${linhaDet('Situação', num(p.consertado) ? '✅ Consertado' : '⚠ Com defeito (sem conserto)', num(p.consertado) ? 'pos' : 'neg')}
    </div>` : ''}

    <div class="acoes">
      <a class="btn prim" href="#/form/${p.uid}">✏️ Editar</a>
      ${p.data_venda ? '' : `<a class="btn" href="#/form/${p.uid}?vender=1">🛒 Registrar venda</a>`}
      <button type="button" class="btn perigo" id="excluir">🗑 Excluir</button>
    </div>`;

  $$('[data-parcela]', tela).forEach((b) => b.addEventListener('click', () => {
    const x = Dados.estado().parcelas[b.dataset.parcela];
    Dados.gravar('parcelas', b.dataset.parcela, num(x.pago) ? { pago: 0, data_pagamento: '' } : { pago: 1, data_pagamento: hojeISO() });
    render();
  }));
  $('#excluir').addEventListener('click', () => {
    if (!confirm(`Excluir "${nomeExibicao(p)}"?\n\nEsta ação não pode ser desfeita.`)) return;
    Dados.emLote(() => {
      for (const x of Dados.parcelasDe(p.uid)) Dados.excluir('parcelas', x.uid);
      Dados.excluir('produtos', p.uid);
    });
    toast('Produto excluído');
    voltar(`#/lista/compras?cat=${p.categoria}`);
  });
}

// Troca: aparelhos que entraram como base de troca nesta venda (troca_de = uid da venda) e o lucro
// total da operação; ou, num aparelho que veio de troca, de qual venda ele veio.
function blocoTroca(p, lucroVenda) {
  const entrou = Dados.produtos().filter((x) => x.troca_de === p.uid);
  const veio = p.troca_de ? Dados.produto(p.troca_de) : null;
  if (!entrou.length && !veio) return '';
  let total = lucroVenda, pendentes = 0;
  const linhas = entrou.map((x) => {
    const l = num(x.preco_venda) - custo(x);
    if (vendido(x)) {
      total += l;
      return linhaDet('Entrou na troca', `<a href="#/produto/${x.uid}">${esc(nomeExibicao(x))}</a><br><span class="sub">custo ${fmtBRL(custo(x))} → vendido em ${fmtData(x.data_venda)} por ${fmtBRL(x.preco_venda)}</span> <span class="${cls(l)}">(lucro ${fmtBRL(l)})</span>`);
    }
    pendentes++;
    return linhaDet('Entrou na troca', `<a href="#/produto/${x.uid}">${esc(nomeExibicao(x))}</a><br><span class="sub">custo ${fmtBRL(custo(x))} — ainda em estoque</span>`);
  }).join('');
  return `<div class="secao" style="--cor:var(--azul)">🔁 Troca</div>
    <div class="card det">
      ${veio ? linhaDet('Entrou na troca da venda de', `<a href="#/produto/${veio.uid}">${esc(nomeExibicao(veio))}</a> <span class="sub">(${fmtData(veio.data_venda)})</span>`) : ''}
      ${linhas}
      ${entrou.length ? linhaDet('Lucro total da troca', `${fmtBRL(total)}${pendentes ? ' <span class="sub">(+ o que vender do que está em estoque)</span>' : ''}`, `forte ${cls(total)}`) : ''}
    </div>`;
}

// ─── Cadastro / edição de produto ───────────────────────────────────────────
const opcoes = (lista, atual) => lista.map((o) => `<option value="${esc(o)}" ${o === atual ? 'selected' : ''}>${esc(o) || '—'}</option>`).join('');
const campo = (rotulo, html, extra = '') => `<label class="campo" ${extra}><span>${rotulo}</span>${html}</label>`;
const entrada = (nome, tipo = 'text', attrs = '') => `<input type="${tipo}" name="${nome}" ${tipo === 'text' && /preco|custo|val_/.test(nome) ? 'inputmode="decimal" placeholder="0,00"' : ''} ${attrs}>`;

// vendas recentes (e a já ligada, se for antiga) para escolher de qual troca o aparelho veio
function opcoesTroca(p) {
  let vendas = Dados.produtos().filter((x) => vendido(x) && x.uid !== p?.uid)
    .sort((a, b) => b.data_venda.localeCompare(a.data_venda)).slice(0, 80);
  if (p?.troca_de && !vendas.some((x) => x.uid === p.troca_de) && Dados.produto(p.troca_de)) vendas.push(Dados.produto(p.troca_de));
  return vendas.map((x) => `<option value="${x.uid}" ${x.uid === p?.troca_de ? 'selected' : ''}>${fmtData(x.data_venda)} — ${esc(nomeExibicao(x).slice(0, 40))} — ${fmtBRL(x.preco_venda)}</option>`).join('');
}

function nomeGerado(f) {
  const partes = [];
  if (f.c_console) { if (f.console_nome) partes.push(f.console_nome); }
  if (f.c_acessorio) {
    const ac = [];
    if (f.acess_desc) ac.push(f.acess_desc);
    if (f.ctrl_orig) ac.push(`${f.ctrl_orig}ctrl.orig`);
    if (f.ctrl_para) ac.push(`${f.ctrl_para}ctrl.para`);
    if (f.tem_cabos) ac.push('cabos');
    if (ac.length) partes.push(ac.join(', '));
  }
  if (f.c_jogo && f.jogos_desc) partes.push(f.jogos_desc);
  if (f.c_servico && f.servico_desc) partes.push(f.servico_desc);
  return partes.join(' | ') || 'Games';
}

function vForm(r) {
  const uidEdit = r.partes[1] && r.partes[1] !== 'novo' ? r.partes[1] : null;
  const p = uidEdit ? Dados.produto(uidEdit) : null;
  if (uidEdit && !p) { titulo('Produto', true); tela.innerHTML = '<div class="vazio">Produto não encontrado.</div>'; return; }
  const cat = p?.categoria || r.q.get('cat') || pref.cat;
  const eCel = cat === 'celulares';
  const vender = r.q.get('vender') === '1';
  titulo(p ? (vender ? 'Registrar venda' : 'Editar produto') : `Novo — ${eCel ? 'celular' : 'games'}`, true);
  formAberto = true;

  const parcelasExist = p ? Dados.parcelasDe(p.uid) : [];
  let parcelasGeradas = parcelasExist.length > 0;
  let unidades = []; // lote: [{data, preco}]
  let parcelasForm = []; // fiado: [{data, valor}] — data e valor livres

  tela.innerHTML = `<form id="f" novalidate autocomplete="off">
    ${eCel ? `<div class="card bloco">
      ${campo('Nome *', entrada('nome'))}
      <div class="duas">
        ${campo('Armazenamento', `<select name="armazenamento">${opcoes(['', ...ARMAZ])}</select>`)}
        ${campo('Saúde da bateria', `<select name="saude_bateria">${opcoes(['', ...BATS])}</select>`)}
      </div></div>` : `<div class="card bloco">
      <div class="titulo">Categoria do produto</div>
      <div class="checks">
        <label class="check"><input type="checkbox" name="c_console"> Console</label>
        <label class="check"><input type="checkbox" name="c_acessorio"> Acessório</label>
        <label class="check"><input type="checkbox" name="c_jogo"> Jogo</label>
        <label class="check"><input type="checkbox" name="c_servico"> Serviço</label>
      </div>
      ${campo('Plataforma', `<select name="plataforma">${opcoes(['', ...PLATAFORMAS])}</select>`, 'id="b_plat"')}
      <div id="b_console"><div class="duas">
        ${campo('Número de série', entrada('num_serie'))}
        ${campo('Descrição (ex: PS4 Fat 500GB)', entrada('console_nome'))}
      </div></div>
      <div id="b_acess">
        <div class="duas">
          ${campo('Ctrl. original', entrada('ctrl_orig', 'number', 'min="0" max="20" inputmode="numeric"'))}
          ${campo('Ctrl. paralelo', entrada('ctrl_para', 'number', 'min="0" max="20" inputmode="numeric"'))}
        </div>
        <label class="check"><input type="checkbox" name="tem_cabos"> Cabos</label>
        ${campo('Descrição do acessório (ex: Headset, Fonte…)', entrada('acess_desc'))}
      </div>
      <div id="b_jogo">${campo('Jogos (separe por vírgula)', entrada('jogos_desc'))}</div>
      <div id="b_servico">${campo('Descrição do serviço (ex: Desbloqueio, Troca de HDMI)', entrada('servico_desc'))}</div>
    </div>`}

    <div class="card bloco">
      <div class="titulo">Compra</div>
      <div class="duas">
        ${campo('Data da compra *', entrada('data_compra', 'date'))}
        ${campo('Preço de compra (R$) *', entrada('preco_compra'))}
      </div>
      <div class="duas">
        ${campo('Preço previsto de venda (R$)', entrada('preco_previsto'))}
        <div class="campo" style="display:flex;align-items:flex-end;padding-bottom:12px"><span id="lucroPrevisto" class="sub"></span></div>
      </div>
      ${p ? '' : `<label class="check"><input type="checkbox" id="lote"> Adicionar em lote (mesmo produto, outras datas)</label>
      <div id="b_lote" class="oculto">
        <div class="sub">Data e preço acima são os da 1ª unidade. Adicione as outras:</div>
        <div id="unidades"></div>
        <div class="acoes" style="margin-top:10px"><button type="button" class="btn peq" id="maisUnidade">+ Outra unidade</button></div>
        <div class="sub" id="resumoLote" style="margin-top:8px;color:var(--azul)"></div>
      </div>`}
      <label class="check"><input type="checkbox" id="troca"> Entrou como base de troca</label>
      <div id="b_troca" class="oculto">${campo('Na venda de', `<select name="troca_de">${opcoesTroca(p)}</select>`)}</div>
      <div class="checks">
        <label class="check"><input type="checkbox" name="reparo"> Com defeito</label>
        <label class="check" id="b_consertado"><input type="checkbox" name="consertado"> ✅ Consertado</label>
      </div>
      <div id="b_rep">
        <div class="duas">
          ${campo('Envio p/ conserto', entrada('data_envio_rep', 'date'))}
          ${campo('Entrega do conserto', entrada('data_entrega_rep', 'date'))}
        </div>
        <div class="sub">Sem data de envio, o produto fica no Estoque marcado “Com defeito”. Com a data de envio, vai para Em conserto; com a data de entrega, volta para o Estoque. A etiqueta “Com defeito” só sai quando “Consertado” estiver marcado.</div>
        ${campo('Custo do conserto (R$)', entrada('custo_reparo'))}
      </div>
    </div>

    <div class="card bloco" id="b_vendaTop">
      <div class="titulo">Venda</div>
      <div class="duas">
        ${campo('Preço de venda (R$)', entrada('preco_venda'))}
        ${campo('Data da venda', entrada('data_venda', 'date'))}
      </div>
      <div id="b_venda">
        <div class="duas">
          ${campo('Nome do comprador', entrada('nome_comprador', 'text', 'autocapitalize="words"'))}
          ${campo('Telefone do comprador', entrada('tel_comprador', 'tel'))}
        </div>
        <div class="titulo" style="margin-top:14px">Forma de pagamento</div>
        ${[['cartao', 'val_cartao', '💳 Cartão'], ['pix', 'val_pix', '💚 Pix'], ['dinheiro', 'val_dinheiro', '💵 Dinheiro'], ['fiado', 'val_fiado', '🧾 Fiado']]
          .map(([k, v, t]) => `<div class="forma"><div class="pagamento"><label class="check"><input type="checkbox" name="pag_${k}"> ${t}</label>
            <div data-val="pag_${k}">${entrada(v, 'text', `aria-label="Valor ${t}"`)}</div></div>
            ${k === 'dinheiro' ? '' : `<div class="duas" data-rec="${k}">
              ${campo('Recebido por', `<select name="rec_${k}_tipo">${opcoes(k === 'fiado' ? ['CPF', 'CNPJ', 'Dinheiro'] : ['CPF', 'CNPJ'])}</select>`)}
              ${campo('Nome do recebedor', entrada(`rec_${k}_nome`), `data-recnome="${k}"`)}
            </div>`}</div>`).join('')}
        <div id="b_fiado">
          <div id="b_fiadoNovo">
          <div class="sub" style="margin-top:6px">Parcelas do fiado: data e valor de cada uma. “+ Parcela” sugere 1 mês depois da anterior e o valor que falta.</div>
          <div id="parcLista"></div>
          <div class="acoes" style="margin-top:8px"><button type="button" class="btn peq" id="maisParc">+ Parcela</button>
            <button type="button" class="btn peq" id="dividirParc">Dividir igualmente</button></div>
          <div class="sub" id="somaParc" style="margin-top:6px"></div></div>
          <div id="b_fiadoInfo" class="aviso"></div>
        </div>
      </div>
    </div>

    <div class="card bloco">
      ${campo('Observações', entrada('observacoes'))}
      ${campo('Status do item', `<select name="status_item">${opcoes(STATUS_ITEM)}</select>`)}
    </div>

    <div class="rodape-form">
      <div class="previa" id="previa"></div>
      <div class="acoes">
        <button type="button" class="btn" id="cancelar">Cancelar</button>
        <button type="submit" class="btn prim">Salvar</button>
      </div>
    </div>
  </form>`;

  const f = $('#f');
  const el = (n) => f.elements[n];
  const setV = (n, v) => { if (el(n)) el(n).value = v ?? ''; };
  const setC = (n, v) => { if (el(n)) el(n).checked = Boolean(num(v)); };

  // ── preencher ──
  if (p) {
    for (const n of ['nome', 'armazenamento', 'saude_bateria', 'plataforma', 'num_serie', 'console_nome', 'jogos_desc',
      'data_compra', 'data_envio_rep', 'data_entrega_rep', 'data_venda', 'nome_comprador', 'tel_comprador',
      'observacoes', 'status_item']) setV(n, p[n]);
    for (const n of ['preco_compra', 'preco_previsto', 'custo_reparo', 'preco_venda', 'val_cartao', 'val_pix', 'val_dinheiro', 'val_fiado']) setV(n, valorCampo(p[n]));
    setV('ctrl_orig', num(p.ctrl_orig) || ''); setV('ctrl_para', num(p.ctrl_para) || '');
    // recebedor de cada forma (venda antiga sem ele: sugere o recebedor único de antes)
    for (const k of ['cartao', 'pix', 'fiado']) {
      const t = p[`rec_${k}_tipo`], lt = p.recebedor_tipo || '';
      const leg = ['CPF', 'CNPJ'].includes(lt) || (k === 'fiado' && lt === 'Dinheiro') ? lt : '';
      setV(`rec_${k}_tipo`, t || leg || 'CPF');
      setV(`rec_${k}_nome`, p[`rec_${k}_nome`] || (!t && ['CPF', 'CNPJ'].includes(leg) ? p.recebedor_nome : '') || '');
    }
    for (const n of ['reparo', 'consertado', 'tem_cabos', 'pag_cartao', 'pag_pix', 'pag_dinheiro', 'pag_fiado']) setC(n, p[n]);
    const cats = subCats(p);
    for (const c of ['console', 'acessorio', 'jogo', 'servico']) setC(`c_${c}`, cats.includes(c));
    setV('servico_desc', p.servico_desc);
    if (p.troca_de) $('#troca').checked = true;
  } else {
    setV('data_compra', hojeISO());
  }
  if (vender && !el('data_venda').value) setV('data_venda', hojeISO());

  // nome gerado ao abrir: se nada da descrição mudar, o nome atual é mantido (a descrição do acessório não fica salva)
  const ler = () => ({
    c_console: el('c_console')?.checked, c_acessorio: el('c_acessorio')?.checked, c_jogo: el('c_jogo')?.checked,
    c_servico: el('c_servico')?.checked, servico_desc: el('servico_desc')?.value.trim(),
    console_nome: el('console_nome')?.value.trim(), acess_desc: el('acess_desc')?.value.trim(),
    ctrl_orig: Math.trunc(num(el('ctrl_orig')?.value)), ctrl_para: Math.trunc(num(el('ctrl_para')?.value)),
    tem_cabos: el('tem_cabos')?.checked, jogos_desc: el('jogos_desc')?.value.trim(),
  });
  const nomeInicial = eCel ? null : nomeGerado(ler());

  // ── mostrar/esconder blocos ──
  function atualizarBlocos() {
    if (!eCel) {
      const c = ler();
      $('#b_console').classList.toggle('oculto', !c.c_console);
      $('#b_acess').classList.toggle('oculto', !c.c_acessorio);
      $('#b_jogo').classList.toggle('oculto', !c.c_jogo);
      $('#b_servico').classList.toggle('oculto', !c.c_servico);
      $('#b_plat').classList.toggle('oculto', !(c.c_console || c.c_acessorio || c.c_jogo || c.c_servico));
    }
    $('#b_rep').classList.toggle('oculto', !el('reparo').checked);
    $('#b_troca').classList.toggle('oculto', !$('#troca').checked);
    $('#b_consertado').classList.toggle('oculto', !el('reparo').checked);
    $('#b_venda').classList.toggle('oculto', !el('data_venda').value);
    for (const k of ['cartao', 'pix', 'dinheiro', 'fiado']) {
      $(`[data-val="pag_${k}"]`).classList.toggle('oculto', !el(`pag_${k}`).checked);
    }
    const fiado = el('pag_fiado').checked;
    $('#b_fiado').classList.toggle('oculto', !fiado);
    $('#b_fiadoNovo').classList.toggle('oculto', parcelasGeradas);
    if (fiado && !parcelasGeradas && !parcelasForm.length) novaParcela();
    $('#b_fiadoInfo').classList.toggle('oculto', !parcelasGeradas);
    for (const k of ['cartao', 'pix', 'fiado']) {
      $(`[data-rec="${k}"]`).classList.toggle('oculto', !el(`pag_${k}`).checked);
      $(`[data-recnome="${k}"]`).classList.toggle('oculto', el(`rec_${k}_tipo`).value === 'Dinheiro');
    }
    if ($('#lote')) $('#b_lote').classList.toggle('oculto', !$('#lote').checked);
    calcular();
  }
  function calcular() {
    const pc = lerValor(el('preco_compra').value), cr = el('reparo').checked ? lerValor(el('custo_reparo').value) : 0;
    const pv = lerValor(el('preco_venda').value);
    let txt = '';
    if (pc || pv) {
      txt = `Custo total: <b>${fmtBRL(pc + cr)}</b>`;
      if (pv) {
        const luc = pv - pc - cr, mg = pc + cr ? (luc / (pc + cr)) * 100 : 0;
        txt += ` · Lucro: <b class="${cls(luc)}">${fmtBRL(luc)}</b> · ${mg.toFixed(1).replace('.', ',')}%`;
      }
    }
    $('#previa').innerHTML = txt;
    const pp = lerValor(el('preco_previsto').value);
    if (pp && pc + cr) {
      const lp = pp - pc - cr;
      $('#lucroPrevisto').innerHTML = `Lucro previsto: <b class="${cls(lp)}">${fmtBRL(lp)}</b> (${((lp / (pc + cr)) * 100).toFixed(1).replace('.', ',')}%)`;
    } else $('#lucroPrevisto').textContent = '';
    if ($('#resumoLote')) {
      const total = pc + soma(unidades, (u) => lerValor(u.preco));
      $('#resumoLote').textContent = `${1 + unidades.length} unidades serão cadastradas — total investido: ${fmtBRL(total)}`;
    }
  }
  f.addEventListener('input', atualizarBlocos);
  f.addEventListener('change', atualizarBlocos);

  // ── fiado: parcelas com data e valor livres ──
  function somaParcelas() {
    if (!parcelasForm.length) { $('#somaParc').textContent = ''; return; }
    const soma = parcelasForm.reduce((t, x) => t + lerValor(x.valor), 0), total = lerValor(el('val_fiado').value);
    const ok = Math.abs(soma - total) <= 0.01;
    $('#somaParc').innerHTML = `<span class="${ok ? 'pos' : 'neg'}">Soma das parcelas: ${fmtBRL(soma)} de ${fmtBRL(total)}${ok ? '' : ' — diferente do valor do fiado'}</span>`;
  }
  function desenharParcelas() {
    $('#parcLista').innerHTML = parcelasForm.map((x, i) => `<div class="unidade">
      <div class="unidade-cab"><span>${i + 1}ª parcela</span>
        <button type="button" class="btn x" data-remparc="${i}" aria-label="Remover a ${i + 1}ª parcela">✕</button></div>
      <div class="unidade-campos">
        <input type="date" data-parc="${i}" data-c="data" value="${esc(x.data)}" aria-label="Vencimento da ${i + 1}ª parcela">
        <input type="text" inputmode="decimal" placeholder="0,00" data-parc="${i}" data-c="valor" value="${esc(x.valor)}" aria-label="Valor da ${i + 1}ª parcela">
      </div></div>`).join('');
    $$('[data-parc]', f).forEach((inp) => inp.addEventListener('input', () => { parcelasForm[inp.dataset.parc][inp.dataset.c] = inp.value; somaParcelas(); }));
    $$('[data-remparc]', f).forEach((b) => b.addEventListener('click', () => { parcelasForm.splice(Number(b.dataset.remparc), 1); desenharParcelas(); }));
    somaParcelas();
  }
  function maisUmMes(iso) {
    const [y, m, d] = iso.split('-').map(Number), ano = m === 12 ? y + 1 : y, mes = m === 12 ? 1 : m + 1;
    return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(d, new Date(ano, mes, 0).getDate())).padStart(2, '0')}`;
  };
  // sugere 1 mês depois da anterior (ou da data da venda) e o valor que ainda falta
  function novaParcela() {
    const base = parcelasForm.length ? parcelasForm[parcelasForm.length - 1].data : el('data_venda').value;
    const falta = lerValor(el('val_fiado').value) - parcelasForm.reduce((t, x) => t + lerValor(x.valor), 0);
    parcelasForm.push({ data: base ? maisUmMes(base) : '', valor: falta > 0.004 ? valorCampo(Math.round(falta * 100) / 100) : '' });
    desenharParcelas();
  }
  $('#maisParc').addEventListener('click', novaParcela);
  $('#dividirParc').addEventListener('click', () => {
    const total = lerValor(el('val_fiado').value);
    if (total <= 0) return toast('Informe o valor do fiado primeiro.');
    if (!parcelasForm.length) novaParcela();
    const n = parcelasForm.length, base = Math.round((total / n) * 100) / 100;
    parcelasForm.forEach((x, i) => { x.valor = valorCampo(i === n - 1 ? Math.round((total - base * (n - 1)) * 100) / 100 : base); });
    desenharParcelas();
  });
  el('val_fiado').addEventListener('input', somaParcelas);

  // ── fiado: resumo das parcelas já geradas + refazer ──
  if (parcelasGeradas) {
    const pagas = parcelasExist.filter((x) => num(x.pago)).length;
    $('#b_fiadoInfo').innerHTML = `${parcelasExist.length} parcela(s) geradas — ${pagas} paga(s), ${parcelasExist.length - pagas} pendente(s).
      <div style="margin-top:8px"><button type="button" class="btn peq" id="refazer">🔄 Refazer parcelas</button></div>`;
    $('#refazer').addEventListener('click', () => {
      if (pagas && !confirm(`${pagas} parcela(s) já estão pagas. Refazer o parcelamento apaga esse histórico ao salvar. Continuar?`)) return;
      parcelasForm = parcelasExist.map((x) => ({ data: x.vencimento || '', valor: valorCampo(x.valor) }));
      parcelasGeradas = false;
      desenharParcelas();
      atualizarBlocos();
    });
  }

  // ── lote ──
  function desenharUnidades() {
    $('#unidades').innerHTML = unidades.map((u, i) => `<div class="unidade">
      <div class="unidade-cab"><span>${i + 2}ª unidade</span>
        <button type="button" class="btn x" data-rem="${i}" aria-label="Remover a ${i + 2}ª unidade">✕</button></div>
      <div class="unidade-campos">
        <input type="date" data-u="${i}" data-c="data" value="${esc(u.data)}" aria-label="Data da ${i + 2}ª unidade">
        <input type="text" inputmode="decimal" placeholder="0,00" data-u="${i}" data-c="preco" value="${esc(u.preco)}" aria-label="Preço da ${i + 2}ª unidade">
      </div></div>`).join('');
    $$('[data-u]', f).forEach((inp) => inp.addEventListener('input', () => { unidades[inp.dataset.u][inp.dataset.c] = inp.value; }));
    $$('[data-rem]', f).forEach((b) => b.addEventListener('click', () => {
      unidades.splice(Number(b.dataset.rem), 1);
      if (!unidades.length) $('#lote').checked = false;
      desenharUnidades(); atualizarBlocos();
    }));
  }
  const novaUnidade = () => { unidades.push({ data: el('data_compra').value, preco: el('preco_compra').value }); desenharUnidades(); atualizarBlocos(); };
  if ($('#lote')) {
    $('#lote').addEventListener('change', () => { if ($('#lote').checked && !unidades.length) novaUnidade(); });
    $('#maisUnidade').addEventListener('click', novaUnidade);
  }

  $('#troca').addEventListener('change', () => {
    if (!$('#troca').checked || p?.troca_de) return;
    const mesmoDia = Dados.produtos().find((x) => vendido(x) && x.data_venda === el('data_compra').value && x.uid !== p?.uid);
    if (mesmoDia) el('troca_de').value = mesmoDia.uid; // sugere a venda do mesmo dia da compra
  });
  $('#cancelar').addEventListener('click', () => voltar());
  atualizarBlocos();
  if (vender) setTimeout(() => $('#b_vendaTop').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

  // ── salvar ──
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const erro = (msg, foco) => { toast(msg); if (foco) el(foco)?.focus(); };
    const c = ler();
    let nome;
    if (eCel) {
      nome = el('nome').value.trim();
      if (!nome) return erro('Preencha o nome do produto.', 'nome');
    } else {
      const gerado = nomeGerado(c);
      nome = p && gerado === nomeInicial ? p.nome : gerado;
    }
    const dc = el('data_compra').value, pcTxt = el('preco_compra').value.trim();
    if (!dc || !pcTxt) return erro('Preencha data e preço de compra.', dc ? 'preco_compra' : 'data_compra');

    let parcelasNovas = []; // [{data, valor}] gravadas ao salvar
    if (el('pag_fiado').checked && !parcelasGeradas) {
      if (!parcelasForm.length) return erro('Adicione as parcelas do fiado (botão “+ Parcela”).');
      {
        for (const [i, x] of parcelasForm.entries()) {
          if (!x.data) return erro(`Informe a data da ${i + 1}ª parcela do fiado.`);
          if (lerValor(x.valor) <= 0) return erro(`Informe o valor da ${i + 1}ª parcela do fiado.`);
        }
        parcelasNovas = parcelasForm.map((x) => ({ data: x.data, valor: lerValor(x.valor) })).sort((a, b) => a.data.localeCompare(b.data));
        const somaP = Math.round(parcelasNovas.reduce((t, x) => t + x.valor, 0) * 100) / 100, totalF = lerValor(el('val_fiado').value);
        if (!totalF) el('val_fiado').value = valorCampo(somaP); // fiado vazio: vale a soma das parcelas
        else if (Math.abs(somaP - totalF) > 0.01) return erro(`A soma das parcelas (${fmtBRL(somaP)}) é diferente do valor do fiado (${fmtBRL(totalF)}). Ajuste ou use “Dividir igualmente”.`);
      }
    }

    const unid = [{ data: dc, preco: lerValor(pcTxt) }];
    if (!p && $('#lote')?.checked) {
      for (const [i, u] of unidades.entries()) {
        if (!u.data || !String(u.preco).trim()) return erro(`Preencha a data e o preço da ${i + 2}ª unidade (ou remova).`);
        unid.push({ data: u.data, preco: lerValor(u.preco) });
      }
      if (unid.length > 1 && !confirm(`Serão cadastradas ${unid.length} unidades:\n\n${unid.map((u, i) => `${i + 1}ª — ${fmtData(u.data)} — ${fmtBRL(u.preco)}`).join('\n')}\n\nTotal: ${fmtBRL(soma(unid, (u) => u.preco))}\n\nConfirmar?`)) return;
    }

    const sc = eCel ? [] : ['console', 'acessorio', 'jogo', 'servico'].filter((k) => c[`c_${k}`]);
    const txt = (n) => (el(n)?.value || '').trim();
    const d = {
      nome, categoria: cat,
      preco_previsto: lerValor(el('preco_previsto').value),
      reparo: el('reparo').checked ? 1 : 0,
      consertado: el('reparo').checked && el('consertado').checked ? 1 : 0,
      custo_reparo: el('reparo').checked ? lerValor(el('custo_reparo').value) : 0,
      preco_venda: lerValor(el('preco_venda').value), data_venda: el('data_venda').value,
      observacoes: txt('observacoes'),
      armazenamento: eCel ? el('armazenamento').value : '', saude_bateria: eCel ? el('saude_bateria').value : '',
      sub_cats: JSON.stringify(sc),
      console_nome: eCel ? '' : txt('console_nome'),
      ctrl_orig: c.ctrl_orig || 0, ctrl_para: c.ctrl_para || 0, tem_cabos: c.tem_cabos ? 1 : 0,
      jogos_desc: eCel ? '' : txt('jogos_desc'),
      servico_desc: !eCel && c.c_servico ? txt('servico_desc') : '',
      troca_de: $('#troca').checked ? el('troca_de').value : '',
      nome_comprador: txt('nome_comprador'), tel_comprador: txt('tel_comprador'),
      data_envio_rep: el('reparo').checked ? el('data_envio_rep').value : '',
      data_entrega_rep: el('reparo').checked ? el('data_entrega_rep').value : '',
      plataforma: eCel ? '' : el('plataforma').value, num_serie: eCel ? '' : txt('num_serie'),
      status_item: el('status_item').value,
    };
    for (const k of ['cartao', 'pix', 'fiado']) {
      const tipo = el(`pag_${k}`).checked ? el(`rec_${k}_tipo`).value : '';
      d[`rec_${k}_tipo`] = tipo;
      d[`rec_${k}_nome`] = tipo && tipo !== 'Dinheiro' ? txt(`rec_${k}_nome`) : '';
    }
    for (const k of ['cartao', 'pix', 'dinheiro', 'fiado']) {
      const marcado = el(`pag_${k}`).checked;
      d[`pag_${k}`] = marcado ? 1 : 0;
      d[`val_${k}`] = marcado ? lerValor(el(`val_${k}`).value) : 0;
    }

    const salvos = Dados.emLote(() => {
      const uids = [];
      if (p) {
        uids.push(Dados.gravar('produtos', p.uid, { ...d, data_compra: dc, preco_compra: lerValor(pcTxt) }));
      } else {
        unid.forEach((u, i) => uids.push(Dados.gravar('produtos', null, {
          ...d, data_compra: u.data, preco_compra: u.preco, num_serie: i ? '' : d.num_serie, troca_de: i ? '' : d.troca_de, criado_em: agoraSQL(),
        })));
      }
      for (const uid of uids) {
        if (d.pag_fiado && !parcelasGeradas && parcelasNovas.length) {
          for (const x of Dados.parcelasDe(uid)) Dados.excluir('parcelas', x.uid);
          parcelasNovas.forEach((x, i) => Dados.gravar('parcelas', null, {
            produto_uid: uid, numero: i + 1, pago: 0, data_pagamento: '', valor: x.valor, vencimento: x.data,
          }));
        } else if (!d.pag_fiado) {
          for (const x of Dados.parcelasDe(uid)) Dados.excluir('parcelas', x.uid);
        }
      }
      return uids;
    });
    formAberto = false;
    toast(salvos.length > 1 ? `${salvos.length} unidades cadastradas` : 'Salvo');
    if (p) voltar(`#/produto/${p.uid}`);
    else ir(`#/lista/compras?cat=${cat}`);
  });
}

// ─── Despesas ───────────────────────────────────────────────────────────────
const FORMAS_DESPESA = { Pix: '<span class="pos">💚 Pix</span>', 'Cartão': '<span style="color:var(--azul)">💳 Cartão</span>' };
const filtroDesp = { modo: 'mes', mes: mesISO(), de: `${mesISO()}-01`, ate: hojeISO() };

function vDespesas() {
  titulo('Despesas', true);
  const todas = Dados.despesas().sort((a, b) => (b.data || '').localeCompare(a.data || '') || b.u - a.u);
  const hoje = hojeISO(), mes = mesISO();
  const tot = (l) => soma(l, (d) => num(d.valor));
  let ini = '', fim = '', desc = 'Todas as despesas';
  if (filtroDesp.modo === 'mes') {
    const [y, m] = filtroDesp.mes.split('-').map(Number);
    ini = `${filtroDesp.mes}-01`; fim = `${filtroDesp.mes}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    desc = `${MESES[m - 1]}/${y}`;
  } else if (filtroDesp.modo === 'intervalo') {
    [ini, fim] = [filtroDesp.de, filtroDesp.ate];
    if (ini && fim && ini > fim) [ini, fim] = [fim, ini];
    desc = `${ini ? fmtData(ini) : 'início'} até ${fim ? fmtData(fim) : 'hoje'}`;
  }
  const lista = todas.filter((d) => (!ini || d.data >= ini) && (!fim || d.data <= fim));

  tela.innerHTML = `
    <div class="sub">Hoje: ${fmtBRL(tot(todas.filter((d) => d.data === hoje)))} · Mês atual: ${fmtBRL(tot(todas.filter((d) => (d.data || '').startsWith(mes))))} · Total: ${fmtBRL(tot(todas))}</div>
    <div class="segmento" style="margin-top:10px">
      ${[['mes', 'Por mês'], ['intervalo', 'Intervalo'], ['todas', 'Todas']].map(([m, t]) => `<button type="button" class="${filtroDesp.modo === m ? 'ativo' : ''}" data-modo="${m}">${t}</button>`).join('')}
    </div>
    ${filtroDesp.modo === 'mes' ? `<div class="periodo">
      <button type="button" class="btn peq" data-mes="-1" aria-label="Mês anterior">◀</button><b>${desc}</b>
      <button type="button" class="btn peq" data-mes="1" aria-label="Próximo mês">▶</button>
      ${filtroDesp.mes !== mes ? '<button type="button" class="btn peq" data-mes="0">Atual</button>' : ''}</div>` : ''}
    ${filtroDesp.modo === 'intervalo' ? `<div class="duas">
      ${campo('De', `<input type="date" id="dDe" value="${filtroDesp.de}">`)}${campo('Até', `<input type="date" id="dAte" value="${filtroDesp.ate}">`)}</div>` : ''}
    <div class="secao" style="--cor:var(--verm)">${esc(desc)}: ${fmtBRL(tot(lista))} (${lista.length})</div>
    <div class="grade" style="margin-bottom:10px">
      ${kpi('💚 Pix', fmtBRL(tot(lista.filter((d) => d.forma_pagamento === 'Pix'))), { cor: 'var(--verde)' })}
      ${kpi('💳 Cartão', fmtBRL(tot(lista.filter((d) => d.forma_pagamento === 'Cartão'))), { cor: 'var(--azul)' })}
    </div>
    ${lista.some((d) => !FORMAS_DESPESA[d.forma_pagamento]) ? `<div class="sub" style="margin-bottom:8px">❔ Sem forma: ${fmtBRL(tot(lista.filter((d) => !FORMAS_DESPESA[d.forma_pagamento])))} — toque na despesa para escolher Pix ou Cartão</div>` : ''}
    <div class="itens">${lista.length ? lista.map((d) => `<a class="card item" href="#/despesa/${d.uid}">
      <div class="item-topo"><span class="item-nome">${esc(d.nome)}</span><b class="neg">${fmtBRL(d.valor)}</b></div>
      <div class="linha"><span>${fmtData(d.data)}</span>${FORMAS_DESPESA[d.forma_pagamento] || '<span class="neg">❔ sem forma</span>'}${d.descricao ? `<span>${esc(d.descricao)}</span>` : ''}</div></a>`).join('')
      : '<div class="vazio">Nenhuma despesa neste período.</div>'}</div>
    <button type="button" class="fab" aria-label="Nova despesa" data-ir="#/despesa/nova">+</button>`;

  $$('[data-modo]', tela).forEach((b) => b.addEventListener('click', () => { filtroDesp.modo = b.dataset.modo; render(); }));
  $$('[data-mes]', tela).forEach((b) => b.addEventListener('click', () => {
    const delta = Number(b.dataset.mes);
    if (!delta) filtroDesp.mes = mes;
    else {
      const [y, m] = filtroDesp.mes.split('-').map(Number);
      const dt = new Date(y, m - 1 + delta, 1);
      filtroDesp.mes = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    }
    render();
  }));
  $('#dDe')?.addEventListener('change', (e) => { filtroDesp.de = e.target.value; render(); });
  $('#dAte')?.addEventListener('change', (e) => { filtroDesp.ate = e.target.value; render(); });
  $('[data-ir]', tela).addEventListener('click', (e) => ir(e.currentTarget.dataset.ir));
}

function vDespesa(r) {
  const uid = r.partes[1] !== 'nova' ? r.partes[1] : null;
  const d = uid ? Dados.despesa(uid) : null;
  titulo(d ? 'Editar despesa' : 'Nova despesa', true);
  if (uid && !d) { tela.innerHTML = '<div class="vazio">Despesa não encontrada.</div>'; return; }
  formAberto = true;
  tela.innerHTML = `<form id="f" class="card bloco" novalidate autocomplete="off">
    ${campo('Nome *', `<input type="text" name="nome" value="${esc(d?.nome)}" autocapitalize="sentences">`)}
    <div class="duas">
      ${campo('Valor (R$) *', `<input type="text" name="valor" inputmode="decimal" placeholder="0,00" value="${esc(valorCampo(d?.valor))}">`)}
      ${campo('Data *', `<input type="date" name="data" value="${esc(d?.data || hojeISO())}">`)}
    </div>
    <div class="campo"><span class="sub">Forma de pagamento *</span>
      <div class="segmento" style="margin-top:4px" id="formaDesp">
        ${[['Pix', '💚 Pix'], ['Cartão', '💳 Cartão']].map(([v, t]) => `<button type="button" data-forma="${v}" class="${d?.forma_pagamento === v ? 'ativo' : ''}">${t}</button>`).join('')}
      </div></div>
    ${campo('Descrição', `<input type="text" name="descricao" value="${esc(d?.descricao)}">`)}
    <div class="acoes">
      ${d ? '<button type="button" class="btn perigo" id="excluir">🗑 Excluir</button>' : ''}
      <button type="submit" class="btn prim">Salvar</button>
    </div></form>`;
  const f = $('#f');
  let forma = d?.forma_pagamento || '';
  $$('[data-forma]', f).forEach((b) => b.addEventListener('click', () => {
    forma = b.dataset.forma;
    $$('[data-forma]', f).forEach((x) => x.classList.toggle('ativo', x === b));
  }));
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const nome = f.elements.nome.value.trim(), valor = f.elements.valor.value.trim(), data = f.elements.data.value;
    if (!nome || !valor || !data) return toast('Preencha nome, valor e data.');
    if (!forma) return toast('Escolha a forma de pagamento: Pix ou Cartão.');
    Dados.gravar('despesas', uid, { nome, valor: lerValor(valor), data, forma_pagamento: forma, descricao: f.elements.descricao.value.trim(), ...(d ? {} : { criado_em: agoraSQL() }) });
    formAberto = false;
    toast('Despesa salva');
    voltar('#/despesas');
  });
  $('#excluir')?.addEventListener('click', () => {
    if (!confirm(`Excluir a despesa "${d.nome}"?`)) return;
    Dados.excluir('despesas', uid);
    formAberto = false;
    voltar('#/despesas');
  });
}

// ─── Lucro a receber do fiado: em qual parcela o lucro começa ────────────────
function vLucroFiado() {
  titulo('Lucro a receber', true);
  const vendas = vendasFiadoAbertas().map((p) => ({ p, pl: pontoLucro(p) }))
    .sort((a, b) => (a.pl.lucrando - b.pl.lucrando) || (a.pl.vencimento || '9999').localeCompare(b.pl.vencimento || '9999'));
  tela.innerHTML = `<div class="sub">O custo de cada venda volta primeiro; a partir da parcela marcada, o que entra é lucro.</div>
    <div class="itens" style="margin-top:10px">${vendas.length ? vendas.map(({ p, pl }) => {
      let txt, cl;
      if (pl.n === null) { txt = '⚠ Venda no prejuízo: as parcelas não cobrem o custo'; cl = 'neg'; }
      else if (pl.n === 0 || pl.lucrando) { txt = `✅ Já lucrando ${pl.n === 0 ? 'desde a entrada' : `desde a ${pl.n}ª parcela`}`; cl = 'pos'; }
      else {
        txt = `💰 O lucro começa na <b>${pl.n}ª parcela</b>${pl.vencimento ? ` (venc. ${fmtData(pl.vencimento)})` : ''} — entram ${fmtBRL(pl.lucroNa)} de lucro nela<br>Falta cobrir ${fmtBRL(pl.faltaCusto)} do custo`;
        cl = '';
      }
      return `<a class="card item" href="#/produto/${p.uid}">
        <div class="item-topo"><span class="item-nome">${p.categoria === 'games' ? '🎮' : '📱'} ${esc(nomeExibicao(p))}</span><b>${fmtBRL(num(p.preco_venda) - custo(p))}</b></div>
        <div class="linha">${p.nome_comprador ? `<span>🧑 ${esc(p.nome_comprador)}</span>` : ''}<span>recebido ${fmtBRL(pl.recebido)} de ${fmtBRL(p.preco_venda)}</span><span>${pl.pagas}/${pl.totalParcelas} parcelas</span></div>
        <div class="linha"><span class="${cl}" style="color:${cl ? '' : 'var(--amb)'}">${txt}</span></div></a>`;
    }).join('') : '<div class="vazio">Nenhuma venda no fiado em aberto.</div>'}</div>`;
}

// ─── Fiado ──────────────────────────────────────────────────────────────────
function vFiado() {
  titulo('Fiado — em aberto', true);
  const prod = Dados.estado().produtos;
  const hoje = hojeISO();
  const lista = Dados.parcelas().filter((x) => !num(x.pago) && prod[x.produto_uid])
    .sort((a, b) => (!a.vencimento) - (!b.vencimento) || (a.vencimento || '').localeCompare(b.vencimento || ''));
  tela.innerHTML = `<div class="sub">${lista.length} parcela(s) em aberto — total de <b>${fmtBRL(soma(lista, (x) => num(x.valor)))}</b></div>
    <div class="itens" style="margin-top:10px">${lista.length ? lista.map((x) => {
      const p = { ...prod[x.produto_uid], uid: x.produto_uid };
      const atras = x.vencimento && x.vencimento < hoje;
      return `<div class="card item">
        <div class="item-topo"><span class="item-nome">${p.categoria === 'games' ? '🎮' : '📱'} ${esc(nomeExibicao(p))}</span><b>${fmtBRL(x.valor)}</b></div>
        <div class="linha">${p.nome_comprador ? `<span>🧑 ${esc(p.nome_comprador)}</span>` : ''}<span>${x.numero}ª parcela</span>
          ${x.vencimento ? `<span>venc. ${fmtData(x.vencimento)}</span>` : ''}<span class="${atras ? 'neg' : ''}">${atras ? '⚠ Atrasada' : '⏳ Pendente'}</span></div>
        <div class="acoes" style="margin-top:10px">
          <a class="btn peq" href="#/produto/${p.uid}">Ver venda</a>
          <button type="button" class="btn peq prim" data-pagar="${x.uid}">Marcar paga</button></div></div>`;
    }).join('') : '<div class="vazio">Nenhuma parcela em aberto. 🎉</div>'}</div>`;
  $$('[data-pagar]', tela).forEach((b) => b.addEventListener('click', () => {
    Dados.gravar('parcelas', b.dataset.pagar, { pago: 1, data_pagamento: hojeISO() });
    toast('Parcela marcada como paga');
    render();
  }));
}

// ─── Clientes ───────────────────────────────────────────────────────────────
const filtroCli = { busca: '', ordem: 'Nome' };
function vClientes() {
  titulo('Clientes', true);
  const mapa = new Map();
  for (const p of Dados.produtos()) {
    const nome = (p.nome_comprador || '').trim();
    if (!nome || !p.data_venda) continue;
    const c = mapa.get(nome) || { nome, tel: '', qtd: 0, total: 0, ultima: '' };
    c.qtd++; c.total += num(p.preco_venda);
    if ((p.tel_comprador || '') > c.tel) c.tel = p.tel_comprador;
    if (p.data_venda > c.ultima) c.ultima = p.data_venda;
    mapa.set(nome, c);
  }
  tela.innerHTML = `<div class="filtros">
      <div class="busca"><input type="search" id="buscaCli" placeholder="Buscar nome ou telefone" value="${esc(filtroCli.busca)}"></div>
      <select id="ordemCli" aria-label="Ordenar">${opcoes(['Nome', 'Valor gasto', 'Mais recente', 'Mais antigo'], filtroCli.ordem)}</select>
    </div><div class="contador" id="nCli"></div><div class="itens" id="listaCli"></div>`;
  const desenhar = () => {
    const termo = filtroCli.busca.trim().toLowerCase();
    let l = [...mapa.values()].filter((c) => !termo || c.nome.toLowerCase().includes(termo) || (c.tel || '').includes(termo));
    const ord = { 'Valor gasto': (a, b) => b.total - a.total, 'Mais recente': (a, b) => b.ultima.localeCompare(a.ultima),
      'Mais antigo': (a, b) => a.ultima.localeCompare(b.ultima) }[filtroCli.ordem] || ((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
    l.sort(ord);
    $('#nCli').textContent = `${l.length} cliente(s)`;
    $('#listaCli').innerHTML = l.length ? l.map((c) => `<a class="card item" href="#/cliente?nome=${encodeURIComponent(c.nome)}">
      <div class="item-topo"><span class="item-nome">${esc(c.nome)}</span><span class="sub">${esc(c.tel || 'sem telefone')}</span></div>
      <div class="linha"><span>${c.qtd} compra(s)</span><span>total <b>${fmtBRL(c.total)}</b></span>${c.ultima ? `<span>última ${fmtData(c.ultima)}</span>` : ''}</div></a>`).join('')
      : '<div class="vazio">Nenhum cliente encontrado.</div>';
  };
  $('#buscaCli').addEventListener('input', (e) => { filtroCli.busca = e.target.value; desenhar(); });
  $('#ordemCli').addEventListener('change', (e) => { filtroCli.ordem = e.target.value; desenhar(); });
  desenhar();
}

function vCliente(r) {
  const nome = r.q.get('nome') || '';
  titulo(nome || 'Cliente', true);
  const compras = Dados.produtos().filter((p) => (p.nome_comprador || '').trim() === nome && p.data_venda)
    .sort((a, b) => b.data_venda.localeCompare(a.data_venda));
  tela.innerHTML = `<div class="sub">${compras.length} compra(s) — total ${fmtBRL(soma(compras, (p) => num(p.preco_venda)))}</div>
    <div class="itens" style="margin-top:10px">${compras.map((p) => `<a class="card item" href="#/produto/${p.uid}">
      <div class="item-topo"><span class="item-nome">${p.categoria === 'games' ? '🎮' : '📱'} ${esc(nomeExibicao(p))}</span><b class="pos">${fmtBRL(p.preco_venda)}</b></div>
      <div class="linha"><span>${fmtData(p.data_venda)}</span></div></a>`).join('') || '<div class="vazio">Nenhuma compra.</div>'}</div>`;
}

// ─── Mais / Configuração ────────────────────────────────────────────────────
function vMais() {
  titulo('Mais');
  const abertas = Dados.parcelas().filter((x) => !num(x.pago));
  const e = Sync.estado;
  tela.innerHTML = `<div class="card lista-mais">
      <a href="#/despesas"><span>💸</span><b>Despesas</b><small>${fmtBRL(soma(Dados.despesas().filter((d) => (d.data || '').startsWith(mesISO())), (d) => num(d.valor)))} no mês</small></a>
      <a href="#/fiado"><span>🧾</span><b>Fiado</b><small>${abertas.length} em aberto</small></a>
      <a href="#/clientes"><span>👥</span><b>Clientes</b><small>›</small></a>
      <a href="#/config"><span>⚙️</span><b>Sincronização</b><small>${{ ok: 'ligada', sincronizando: 'ligada', erro: 'com erro', desligado: 'desligada' }[e.status]}</small></a>
    </div>
    <div class="sub" style="margin-top:14px;text-align:center">Gestão de Vendas · versão ${GV_VERSAO}</div>`;
}

let cfgPendente = null; // token + Gist vindos do QR/link, esperando a senha

function lerLinkConfig(texto) {
  const m = /#cfg=([\w-]+)/.exec(texto || '');
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const d = JSON.parse(atob(b64 + '==='.slice((b64.length + 3) % 4)));
    return d.t && d.g ? { token: d.t, gistId: d.g, ...(d.a ? { api: d.a } : {}) } : null;
  } catch { return null; }
}
function receberLinkConfig(texto) {
  const cfg = lerLinkConfig(texto);
  history.replaceState(null, '', `${location.pathname}${location.search}#/config`); // tira o token da barra de endereço
  if (cfg) cfgPendente = cfg; else toast('Link de configuração inválido');
  render();
}

function vConfig() {
  titulo('Sincronização', true);
  const e = Sync.estado;
  if (Sync.configurado()) {
    const quando = e.ultima ? new Date(e.ultima).toLocaleString('pt-BR') : '—';
    tela.innerHTML = `<div class="card pad">
        <div class="det-titulo">${{ ok: '✅ Sincronizado', sincronizando: '🔄 Sincronizando…', erro: '⚠️ Problema na sincronização', desligado: '—' }[e.status]}</div>
        <div class="sub">Última sincronização: ${quando}</div>
        ${e.status === 'erro' ? `<div class="aviso erro">${esc(e.erro)}<br><small>As alterações feitas aqui ficam guardadas no aparelho e sobem quando der.</small></div>` : ''}
        <div class="acoes"><button type="button" class="btn prim" id="sincAgora">Sincronizar agora</button></div>
      </div>
      <div class="card pad" style="margin-top:12px">
        <b>Como funciona</b>
        <p class="sub">Tudo o que você altera aqui vai para o PC em segundos (e vice-versa), criptografado com a sua senha.
        Sem internet, as alterações ficam guardadas no aparelho e são enviadas quando a conexão voltar. Fotos ficam só no PC.</p>
        <div class="acoes"><button type="button" class="btn perigo" id="desconectar">Desconectar este aparelho</button></div>
      </div>
      <div class="sub" style="margin-top:14px;text-align:center">versão ${GV_VERSAO}</div>`;
    $('#sincAgora').addEventListener('click', () => Sync.agora());
    $('#desconectar').addEventListener('click', () => {
      if (!confirm('Desconectar e apagar os dados DESTE aparelho?\n\nNada é apagado no PC nem na nuvem. Para voltar, leia o QR do PC de novo.')) return;
      Sync.desconectar(); Dados.apagarTudo(); ir('#/inicio');
    });
    return;
  }

  formAberto = true; // não redesenhar enquanto a senha é digitada
  tela.innerHTML = cfgPendente ? `<form id="fSenha" class="card pad" autocomplete="off">
      <div class="det-titulo">🔐 Quase lá</div>
      <p class="sub">Digite a senha da sincronização (a mesma que você criou no PC, em 📱 Celular).</p>
      ${campo('Senha', '<input type="password" name="senha" autocomplete="current-password" required>')}
      <div class="acoes"><button type="submit" class="btn prim" id="btnConectar">Conectar</button></div>
      <div id="msgCfg"></div>
    </form>` : `${cartaoConectar().replace('<div class="acoes"><a class="btn prim" href="#/config">Configurar</a></div>', '')}
    <div class="acoes"><button type="button" class="btn prim" id="lerQr">📷 Ler QR do PC</button></div>
    <div id="leitor" class="card oculto" style="margin-top:12px;overflow:hidden">
      <video id="videoQr" playsinline muted style="width:100%;display:block"></video>
      <div class="acoes" style="margin:8px"><button type="button" class="btn" id="pararQr">Cancelar</button></div>
    </div>
    <details class="card pad" style="margin-top:12px"><summary>Sem câmera? Colar o link do PC</summary>
      ${campo('Link (botão “Copiar link” no PC)', '<input type="text" id="linkCfg" placeholder="https://…#cfg=…">')}
      <div class="acoes"><button type="button" class="btn" id="usarLink">Usar link</button></div>
    </details>`;

  if (cfgPendente) {
    const f = $('#fSenha');
    f.elements.senha.focus();
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = $('#btnConectar');
      btn.disabled = true; btn.textContent = 'Conectando…';
      try {
        await Sync.conectar(cfgPendente, f.elements.senha.value);
        cfgPendente = null; formAberto = false;
        toast('Conectado! Dados carregados.');
        ir('#/inicio');
      } catch (err) {
        $('#msgCfg').innerHTML = `<div class="aviso erro">${esc(err.message)}</div>`;
        btn.disabled = false; btn.textContent = 'Conectar';
      }
    });
    return;
  }
  $('#usarLink').addEventListener('click', () => receberLinkConfig($('#linkCfg').value));
  $('#lerQr').addEventListener('click', lerQr);
  $('#pararQr').addEventListener('click', pararQr);
}

// Leitor de QR dentro do app (no iPhone, o app da tela de início não enxerga o que foi aberto no Safari)
let qrStream = null, jsQrScript = null;
function pararQr() {
  qrStream?.getTracks().forEach((t) => t.stop());
  qrStream = null;
  $('#leitor')?.classList.add('oculto');
}
window.addEventListener('hashchange', pararQr);
async function lerQr() {
  const video = $('#videoQr');
  try {
    qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    return toast('Sem acesso à câmera — permita nas configurações ou cole o link');
  }
  video.srcObject = qrStream;
  $('#leitor').classList.remove('oculto');
  await video.play().catch(() => {});
  let ler;
  if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats?.())?.includes('qr_code')) {
    const det = new BarcodeDetector({ formats: ['qr_code'] });
    ler = async () => (await det.detect(video))[0]?.rawValue;
  } else {
    try {
      jsQrScript ??= new Promise((ok, falha) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
        s.onload = ok; s.onerror = () => { jsQrScript = null; falha(new Error()); };
        document.head.appendChild(s);
      });
      await jsQrScript;
    } catch { pararQr(); return toast('Não foi possível carregar o leitor — cole o link'); }
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d', { willReadFrequently: true });
    ler = async () => {
      if (!video.videoWidth) return null;
      cv.width = video.videoWidth; cv.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      return jsQR(ctx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height)?.data;
    };
  }
  while (qrStream) {
    const texto = await ler().catch(() => null);
    if (texto?.includes('#cfg=')) { pararQr(); return receberLinkConfig(texto); }
    await new Promise((r) => setTimeout(r, 250));
  }
}

// ─── Início ─────────────────────────────────────────────────────────────────
atualizarPill();
render();
Sync.iniciar();
Sync.agora();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Zoom da página bloqueado no celular (pinça e dois toques não ampliam sem querer):
// - iPhone/Safari ignora o user-scalable=no e manda eventos "gesture*" na pinça;
// - fallback: dois dedos se mexendo não fazem nada (exceto nas fotos em tela cheia).
for (const tipo of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(tipo, (e) => { if (!e.target.closest?.('#galeria')) e.preventDefault(); }, { passive: false });
}
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1 && !e.target.closest?.('#galeria')) e.preventDefault();
}, { passive: false });
