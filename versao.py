"""Rode antes de publicar qualquer mudança no site: python versao.py
Sobe a versão em config.js, o ?v= dos arquivos em index.html/sw.js e o nome do cache do sw.js.
Sem isso o app instalado no celular continua com o CSS/JS antigo guardado no cache."""
import re, pathlib

base = pathlib.Path(__file__).parent
cfg = base / "config.js"
texto = cfg.read_text(encoding="utf-8")
atual = int(re.search(r"GV_VERSAO = (\d+)", texto).group(1))
nova = atual + 1
cfg.write_text(texto.replace(f"GV_VERSAO = {atual}", f"GV_VERSAO = {nova}"), encoding="utf-8")
for nome in ("index.html", "sw.js"):
    arq = base / nome
    t = re.sub(r"\?v=\d+", f"?v={nova}", arq.read_text(encoding="utf-8"))
    t = re.sub(r"gestao-v\d+", f"gestao-v{nova}", t)
    arq.write_text(t, encoding="utf-8")
print(f"versão {atual} -> {nova}")
