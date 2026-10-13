// Sincronização com o Gist (mesmo arquivo que o programa do PC lê e grava).
// Ciclo: baixa (só se mudou — ETag/304) → junta com o aparelho → envia se o resultado for diferente.
// Roda ao abrir, a cada 20 s com o app na tela, ao voltar a internet e logo depois de cada alteração.
const Sync = (() => {
  const KEY = 'gestao:sync';
  const ARQUIVO = 'gestao.json';
  const INTERVALO = 20000;
  let etag = null, remoto = null, usarEtag = true;
  let rodando = false, pendente = false, timerAlteracao = null, timerIntervalo = null;
  const estado = { status: 'desligado', erro: '', ultima: 0 };
  const ouvintes = new Set();

  function cfg() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  }
  const configurado = () => { const c = cfg(); return Boolean(c.token && c.gistId && c.chave); };
  const api = (c) => (c.api || GV.api).replace(/\/$/, '');

  function setEstado(status, erro = '') {
    estado.status = status; estado.erro = erro;
    if (status === 'ok') estado.ultima = Date.now();
    for (const fn of ouvintes) fn(estado);
  }

  async function req(c, caminho, { method = 'GET', body, condicional } = {}) {
    const headers = { Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github+json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (condicional && etag && usarEtag) headers['If-None-Match'] = etag;
    let res;
    try {
      res = await fetch(api(c) + caminho, { method, cache: 'no-store', headers, body: body && JSON.stringify(body) });
    } catch (e) {
      if (headers['If-None-Match'] && navigator.onLine) {
        // se o GitHub recusar o If-None-Match no CORS, segue sem ele
        const r = await req(c, caminho, { method, body });
        usarEtag = false;
        return r;
      }
      throw new Error(navigator.onLine ? 'sem resposta do GitHub' : 'sem internet');
    }
    if (res.status === 304) return res;
    if (!res.ok) {
      throw new Error({ 401: 'token do GitHub inválido ou expirado', 403: 'o GitHub recusou o acesso (pausa ou permissão)',
        404: 'dados não encontrados no GitHub' }[res.status] || `erro ${res.status} do GitHub`);
    }
    return res;
  }

  async function lerEnvelope(c, gist) {
    const arq = gist.files?.[ARQUIVO];
    if (!arq) return null;
    let texto = arq.content || '';
    if (arq.truncated) texto = await (await fetch(arq.raw_url, { cache: 'no-store' })).text();
    return texto.trim() ? JSON.parse(texto) : null;
  }

  // Conectar este aparelho: confere a senha abrindo os dados do Gist
  async function conectar({ token, gistId, api: apiTeste }, senha) {
    const c = { token, gistId, ...(apiTeste ? { api: apiTeste } : {}) };
    const gist = await (await req(c, `/gists/${gistId}`)).json();
    const env = await lerEnvelope(c, gist);
    if (!env) throw new Error('o PC ainda não enviou os dados — confira a sincronização no PC');
    const chave = await Cripto.derivar(senha, env.salt, env.iter);
    let dados;
    try { dados = await Cripto.decifrar(env, chave); } catch { throw new Error('senha incorreta'); }
    localStorage.setItem(KEY, JSON.stringify({ ...c, chave, salt: env.salt, iter: env.iter }));
    etag = null; remoto = null;
    Dados.receber(dados);
    iniciar();
    agora();
  }

  function desconectar() {
    localStorage.removeItem(KEY);
    etag = null; remoto = null;
    setEstado('desligado');
  }

  async function ciclo() {
    if (!configurado()) return setEstado('desligado');
    if (rodando) { pendente = true; return; }
    rodando = true;
    setEstado('sincronizando');
    try {
      const c = cfg();
      const res = await req(c, `/gists/${c.gistId}`, { condicional: true });
      let rem;
      if (res.status === 304 && remoto) {
        rem = remoto;
      } else {
        const env = await lerEnvelope(c, await res.json());
        if (!env) rem = estadoVazio();
        else {
          if (env.salt !== c.salt) throw new Error('a senha foi trocada no PC — conecte de novo em ⚙️');
          try { rem = await Cripto.decifrar(env, c.chave); } catch { throw new Error('não foi possível abrir os dados (senha trocada?)'); }
        }
        etag = res.headers.get('ETag');
      }
      // cópia congelada: uma edição feita durante o envio não pode ser dada como "já enviada"
      const novo = JSON.parse(JSON.stringify(Dados.receber(rem)));
      if (!iguais(novo, rem)) {
        const conteudo = await Cripto.cifrar(novo, c.chave, c.salt, c.iter || 310000);
        await req(c, `/gists/${c.gistId}`, { method: 'PATCH', body: { files: { [ARQUIVO]: { content: conteudo } } } });
        etag = null;
      }
      remoto = novo;
      setEstado('ok');
    } catch (e) {
      setEstado('erro', e.message || String(e));
    } finally {
      rodando = false;
      if (pendente) { pendente = false; ciclo(); }
    }
  }

  function agora() { clearTimeout(timerAlteracao); ciclo(); }

  function iniciar() {
    if (timerIntervalo || !configurado()) return;
    timerIntervalo = setInterval(() => { if (document.visibilityState === 'visible') ciclo(); }, INTERVALO);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ciclo(); });
    window.addEventListener('online', ciclo);
    // alteração feita no aparelho → envia logo (espera 1 s para juntar gravações seguidas)
    Dados.ouvir((origem) => {
      if (origem === 'local') { clearTimeout(timerAlteracao); timerAlteracao = setTimeout(ciclo, 1000); }
    });
  }

  return { cfg, configurado, conectar, desconectar, iniciar, agora, estado, ouvir: (fn) => ouvintes.add(fn) };
})();
