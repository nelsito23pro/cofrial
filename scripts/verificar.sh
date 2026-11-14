#!/bin/bash
# Comprueba que el ecosistema está operativo (ejecutar en la EC2 Web, desde la carpeta del proyecto)
cd "$(dirname "$0")/.."
set -a; source .env; set +a
D=${DOMINIO:-localhost}
echo "== Contenedores";               docker compose ps
echo "== Backend por HTTPS (/api/health)"; curl -s --max-time 10 "https://$D/api/health"; echo
echo "== Certificado HTTPS";          echo | openssl s_client -connect "$D:443" -servername "$D" 2>/dev/null | openssl x509 -noout -issuer -enddate 2>/dev/null || echo "Sin certificado todavía (revisa: docker compose logs caddy)"
echo "== HTTP redirige a HTTPS";      curl -s -o /dev/null --max-time 10 -w "HTTP %{http_code} -> %{redirect_url}\n" "http://$D/"
echo "== Grafana por HTTPS";          curl -s -o /dev/null --max-time 10 -w "HTTP %{http_code}\n" "https://grafana.$D/login"
echo "== Telemetría del último minuto (por camión)"
mysql -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" -p"$DB_PASS" cofrial_db -e \
  "SET time_zone='${DB_TIMEZONE:--03:00}';
   SELECT camion_id, COUNT(*) AS lecturas, SUM(alerta_ruptura_frio) AS alertas, MAX(fecha_hora) AS ultima
   FROM telemetria WHERE fecha_hora >= NOW() - INTERVAL 1 MINUTE GROUP BY camion_id;"
echo
echo "Tienda:  https://$D/"
echo "CRM:     https://$D/crm"
echo "Grafana: https://grafana.$D/"
