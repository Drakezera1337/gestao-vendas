# Gestão de Vendas — celular 📱

Versão para celular do programa **Gestão de Vendas** do PC: estoque, vendas, conserto, despesas,
fiado e clientes, sincronizados com o PC em poucos segundos.

Site estático (HTML + CSS + JS, sem build), feito para o **GitHub Pages**. Instalável na tela
inicial e funciona sem internet: as alterações ficam guardadas no aparelho e sobem quando a conexão voltar.

## Como funciona a sincronização

- Os dados ficam num **Gist secreto** do GitHub, **criptografados** (AES-256-GCM; chave derivada da
  senha com PBKDF2-SHA256, 310 mil iterações). Sem a senha, o conteúdo do Gist é ilegível.
- O programa do PC (`sincronizacao.py`, junto do `gestao_vendas.py`) e este site leem e gravam o mesmo arquivo.
- Cada registro tem um identificador único e a data da última alteração; vale a alteração mais recente
  e exclusões também sincronizam. A regra de mescla é a mesma nos dois lados (`dados.js` → `mesclar`).
- Fotos dos produtos ficam só no PC.

Nenhum dado fica neste repositório: aqui só há o código do site.

## Ligar

1. No PC, abra a Gestão de Vendas → **📱 Celular** (menu de cima) → cole um token do GitHub com
   permissão **gist** e crie a senha da sincronização → **Ativar sincronização**.
2. Clique em **Conectar um celular**: aparece um QR code.
3. No celular, abra o site → **Configurar** → **📷 Ler QR do PC** → digite a senha.
4. Adicione à tela inicial (Safari: Compartilhar → Adicionar à Tela de Início; Chrome: ⋮ → Instalar app).

No iPhone, faça a leitura do QR **de dentro do app já instalado** (o app da tela inicial não enxerga
o que foi configurado no Safari).

## Publicar uma mudança

```bash
python versao.py
git add -A
git commit -m "..."
git push
```

## Arquivos

| Arquivo | Função |
|---|---|
| `index.html`, `styles.css` | Estrutura e visual (tema claro/escuro automático) |
| `app.js` | Telas: início, listas, produto, cadastro/edição (com lote e venda), despesas, fiado, clientes, configuração |
| `dados.js` | Dados no aparelho, regra de mescla e regras do negócio (mesmas do PC) |
| `sync.js` | Sincronização com o Gist |
| `cripto.js` | Criptografia (mesmo formato do `sincronizacao.py`) |
| `sw.js`, `manifest.webmanifest` | App instalável e offline |
| `versao.py` | Sobe a versão antes de publicar |
