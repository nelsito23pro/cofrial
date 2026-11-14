#!/bin/bash
# Crea la base cofrial_db en Amazon RDS y carga esquema (31 tablas), datos de demostración y vistas BI.
# También crea el usuario de solo lectura de Grafana (grafana_ro) con permisos mínimos.
# Uso (desde la carpeta raíz del proyecto, con el archivo .env completo):  bash scripts/cargar-bd.sh
# ATENCIÓN: 01_schema.sql BORRA y recrea la base. Úsalo solo para inicializar o reiniciar la demo.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Falta el archivo .env (cp .env.example .env y complétalo)"; exit 1; }
set -a; source .env; set +a
[ -n "${GRAFANA_DB_PASS:-}" ] || { echo "Falta GRAFANA_DB_PASS en .env (clave del usuario de solo lectura de Grafana)"; exit 1; }
MYSQL=(mysql -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" -p"$DB_PASS" --default-character-set=utf8mb4)

echo "Conectando a ${DB_HOST} como ${DB_USER}..."
"${MYSQL[@]}" -e "SELECT VERSION() AS mysql_version;"
for f in db/01_schema.sql db/02_seed.sql db/03_views.sql; do
  echo "Ejecutando $f"
  "${MYSQL[@]}" < "$f"
done

# Mínimo privilegio: Grafana es público (modo demo), así que solo puede LEER las tablas y vistas de su dashboard.
# No ve cliente ni usuario (datos personales y contraseñas) y no puede modificar ni borrar nada.
GU="${GRAFANA_DB_USER:-grafana_ro}"
GP="${GRAFANA_DB_PASS//\'/\'\'}"   # escapa comillas simples para SQL
echo "Creando usuario de solo lectura ${GU} para Grafana"
GRANTS=""
for obj in camion telemetria pedido oportunidad etapa_pipeline requerimiento v_pedido_total v_ultima_lectura v_ventas_vs_alertas; do
  GRANTS+="GRANT SELECT ON cofrial_db.${obj} TO '${GU}'@'%';"
done
"${MYSQL[@]}" -e "CREATE USER IF NOT EXISTS '${GU}'@'%' IDENTIFIED BY '${GP}';
  ALTER USER '${GU}'@'%' IDENTIFIED BY '${GP}';
  ${GRANTS}"

"${MYSQL[@]}" cofrial_db -e "
  SELECT 'tablas' AS objeto, COUNT(*) AS total FROM information_schema.tables WHERE table_schema='cofrial_db' AND table_type='BASE TABLE'
  UNION ALL SELECT 'productos', COUNT(*) FROM producto
  UNION ALL SELECT 'clientes', COUNT(*) FROM cliente
  UNION ALL SELECT 'pedidos', COUNT(*) FROM pedido
  UNION ALL SELECT 'camiones', COUNT(*) FROM camion
  UNION ALL SELECT 'lecturas IoT', COUNT(*) FROM telemetria;
  SHOW GRANTS FOR '${GU}'@'%';"
echo "Base de datos lista."
