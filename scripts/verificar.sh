#!/bin/bash
# Comprueba que el ecosistema está operativo (ejecutar en la EC2 Web, desde la carpeta del proyecto)
cd "$(dirname "$0")/.."
set -a; source .env; set +a
IP=$(curl -s --max-time 3 http://checkip.amazonaws.com || echo "localhost")
echo "== Contenedores";           docker compose ps
echo "== Backend (/api/health)";  curl -s http://localhost/api/health; echo
echo "== Grafana";                curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/login
echo "== Telemetría del último minuto (por camión)"
mysql -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" -p"$DB_PASS" cofrial_db -e \
  "SET time_zone='${DB_TIMEZONE:--03:00}';
   SELECT camion_id, COUNT(*) AS lecturas, SUM(alerta_ruptura_frio) AS alertas, MAX(fecha_hora) AS ultima
   FROM telemetria WHERE fecha_hora >= NOW() - INTERVAL 1 MINUTE GROUP BY camion_id;"
echo
echo "Tienda:  http://$IP/"
echo "CRM:     http://$IP/crm"
echo "Grafana: http://$IP:3000/"
