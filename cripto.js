// Criptografia dos dados no Gist — mesmo formato do sincronizacao.py do PC:
// JSON → gzip → AES-256-GCM, chave derivada da senha com PBKDF2-SHA256.
// Envelope: { v, app, iter, salt, iv, dados } (base64)
const Cripto = (() => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const chaves = new Map();

  function b64(buf) {
    const b = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function processar(bytes, stream) {
    const s = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  // Devolve a chave bruta em base64 (é o que fica salvo no aparelho, nunca a senha)
  async function derivar(senha, saltB64, iteracoes) {
    const base = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: deB64(saltB64), iterations: iteracoes }, base, 256);
    return b64(bits);
  }

  async function chaveAes(chaveB64) {
    if (!chaves.has(chaveB64)) {
      chaves.set(chaveB64, await crypto.subtle.importKey('raw', deB64(chaveB64), 'AES-GCM', false, ['encrypt', 'decrypt']));
    }
    return chaves.get(chaveB64);
  }

  async function cifrar(obj, chaveB64, saltB64, iteracoes) {
    const bruto = await processar(enc.encode(JSON.stringify(obj)), new CompressionStream('gzip'));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chaveAes(chaveB64), bruto);
    return JSON.stringify({ v: 1, app: 'gestao', iter: iteracoes, salt: saltB64, iv: b64(iv), dados: b64(ct) });
  }

  // Senha errada → lança erro (a autenticação do AES-GCM falha)
  async function decifrar(env, chaveB64) {
    const bruto = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(env.iv) }, await chaveAes(chaveB64), deB64(env.dados));
    return JSON.parse(dec.decode(await processar(bruto, new DecompressionStream('gzip'))));
  }

  return { derivar, cifrar, decifrar };
})();
