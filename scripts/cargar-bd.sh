#!/bin/bash
# Crea la base cofrial_db en Amazon RDS y carga esquema (29 tablas), datos de demostración y vistas BI.
# Uso (desde la carpeta raíz del proyecto, con el archivo .env completo):  bash scripts/cargar-bd.sh
# ATENCIÓN: 01_schema.sql BORRA y recrea la base. Úsalo solo para inicializar o reiniciar la demo.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Falta el archivo .env (cp .env.example .env y complétalo)"; exit 1; }
set -a; source .env; set +a
MYSQL=(mysql -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" -p"$DB_PASS" --default-character-set=utf8mb4)

echo "Conectando a ${DB_HOST} como ${DB_USER}..."
"${MYSQL[@]}" -e "SELECT VERSION() AS mysql_version;"
for f in db/01_schema.sql db/02_seed.sql db/03_views.sql; do
  echo "Ejecutando $f"
  "${MYSQL[@]}" < "$f"
done
"${MYSQL[@]}" cofrial_db -e "
  SELECT 'tablas' AS objeto, COUNT(*) AS total FROM information_schema.tables WHERE table_schema='cofrial_db' AND table_type='BASE TABLE'
  UNION ALL SELECT 'productos', COUNT(*) FROM producto
  UNION ALL SELECT 'clientes', COUNT(*) FROM cliente
  UNION ALL SELECT 'pedidos', COUNT(*) FROM pedido
  UNION ALL SELECT 'camiones', COUNT(*) FROM camion
  UNION ALL SELECT 'lecturas IoT', COUNT(*) FROM telemetria;"
echo "Base de datos lista."
