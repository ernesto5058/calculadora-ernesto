# Calculadora Ernesto

Sistema de actualizaciones de la CalculadoraPRO de Ernesto (Scriptable, iPhone):

- `CalculadoraPRO.js` — la calculadora (saldo + transferencia). El script
  **«Actualizar»** dentro de Scriptable la baja desde aqui cuando sale una
  version nueva (marca `// version: N` en la primera linea).
- `.github/workflows/vigia-mercado.yml` + `scripts/foto_mercado.py` — el
  **vigia en la nube**: cada hora, GitHub guarda una foto de los promedios
  publicos P2P de QvaPay (ETECSA y BANK_CUP) en `datos/historico.jsonl`, y la
  ultima en `datos/ultimo.json`. Solo datos publicos, sin llaves.
- `datos/` — el historico del mercado, foto a foto.

Uso diario de la calculadora: 100% offline. La conexion solo se usa para
actualizar y para bajar las fotos del mercado.
