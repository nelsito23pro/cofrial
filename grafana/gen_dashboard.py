"""Genera grafana/dashboards/cofrial.json (dashboard BI: cruce comercial + cadena de frío)."""
import json
DS = {"type": "mysql", "uid": "cofrial-mysql"}
TF = "fecha_hora BETWEEN FROM_UNIXTIME($__unixEpochFrom()) AND FROM_UNIXTIME($__unixEpochTo())"
pid = 0
def q(sql, fmt="table", ref="A"):
    return {"refId": ref, "datasource": DS, "format": fmt, "rawQuery": True, "editorMode": "code", "rawSql": sql}
def panel(tipo, titulo, x, y, w, h, targets, **extra):
    global pid; pid += 1
    p = {"id": pid, "type": tipo, "title": titulo, "datasource": DS, "gridPos": {"x": x, "y": y, "w": w, "h": h}, "targets": targets}
    p.update(extra); return p
def stat(titulo, x, sql, unit="none", rojo=None, decimals=0):
    steps = [{"color": "blue", "value": None}] + ([{"color": "red", "value": rojo}] if rojo is not None else [])
    return panel("stat", titulo, x, 0, 4, 4, [q(sql)],
        fieldConfig={"defaults": {"unit": unit, "decimals": decimals, "thresholds": {"mode": "absolute", "steps": steps}, "color": {"mode": "thresholds"}}, "overrides": []},
        options={"reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False}, "colorMode": "background", "graphMode": "none", "textMode": "value"})

panels = [
    stat("Ventas netas hoy (CLP)", 0, "SELECT COALESCE(SUM(total_neto),0) AS ventas FROM v_pedido_total WHERE fecha_pedido >= CURDATE() AND estado <> 'Cancelado'", "currencyUSD"),
    stat("Pedidos hoy", 4, "SELECT COUNT(*) AS pedidos FROM pedido WHERE fecha_pedido >= CURDATE()"),
    stat("% pedidos por web (14 días)", 8, "SELECT ROUND(100*SUM(id_canal=1)/COUNT(*)) AS pct FROM pedido WHERE fecha_pedido >= CURDATE() - INTERVAL 13 DAY", "percent"),
    stat("Alertas de frío (última hora)", 12, "SELECT COUNT(*) AS alertas FROM telemetria WHERE alerta_ruptura_frio AND fecha_hora >= NOW() - INTERVAL 1 HOUR", rojo=1),
    stat("Camiones transmitiendo (1 min)", 16, "SELECT COUNT(DISTINCT camion_id) AS camiones FROM telemetria WHERE fecha_hora >= NOW() - INTERVAL 1 MINUTE"),
    stat("Requerimientos IA abiertos", 20, "SELECT COUNT(*) AS abiertos FROM requerimiento WHERE NOT resuelto", rojo=1),
    panel("timeseries", "Ventas diarias vs. alertas de ruptura de frío (14 días)", 0, 4, 14, 9, [
        q("SELECT UNIX_TIMESTAMP(dia) AS time, ventas_netas AS 'Ventas netas' FROM v_ventas_vs_alertas WHERE dia >= CURDATE() - INTERVAL 13 DAY ORDER BY dia", "time_series", "A"),
        q("SELECT UNIX_TIMESTAMP(dia) AS time, alertas_frio AS 'Alertas de frío' FROM v_ventas_vs_alertas WHERE dia >= CURDATE() - INTERVAL 13 DAY ORDER BY dia", "time_series", "B")],
        timeFrom="14d",
        fieldConfig={"defaults": {"custom": {"drawStyle": "bars", "fillOpacity": 70, "barAlignment": 0}, "color": {"mode": "fixed", "fixedColor": "#1f8ac0"}},
            "overrides": [{"matcher": {"id": "byName", "options": "Alertas de frío"}, "properties": [
                {"id": "custom.drawStyle", "value": "line"}, {"id": "custom.axisPlacement", "value": "right"}, {"id": "custom.lineWidth", "value": 3},
                {"id": "custom.fillOpacity", "value": 0}, {"id": "custom.pointSize", "value": 7}, {"id": "custom.showPoints", "value": "always"},
                {"id": "color", "value": {"mode": "fixed", "fixedColor": "red"}}]}]},
        options={"legend": {"displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi"}}),
    panel("piechart", "Ventas por canal", 14, 4, 5, 9, [q("SELECT canal, SUM(total_neto) AS ventas FROM v_pedido_total WHERE estado <> 'Cancelado' GROUP BY canal")],
        options={"reduceOptions": {"values": True, "calcs": ["lastNotNull"], "fields": ""}, "pieType": "donut", "legend": {"displayMode": "list", "placement": "bottom"}}),
    panel("barchart", "B2B vs. B2C (ventas netas)", 19, 4, 5, 9, [q("SELECT tipo_cliente, SUM(total_neto) AS ventas FROM v_pedido_total WHERE estado <> 'Cancelado' GROUP BY tipo_cliente")],
        options={"xField": "tipo_cliente", "orientation": "vertical", "legend": {"showLegend": False}}),
    panel("timeseries", "Temperatura de cámara por camión (en vivo)", 0, 13, 14, 9, [
        q(f"SELECT UNIX_TIMESTAMP(fecha_hora) AS time, camion_id AS metric, temp_camara AS value FROM telemetria WHERE {TF} ORDER BY fecha_hora", "time_series")],
        fieldConfig={"defaults": {"unit": "celsius", "custom": {"lineWidth": 2, "showPoints": "never"}}, "overrides": []},
        options={"legend": {"displayMode": "table", "placement": "right", "calcs": ["lastNotNull", "max"]}, "tooltip": {"mode": "multi"}}),
    panel("geomap", "Ubicación actual de la flota (rojo = ruptura de frío)", 14, 13, 10, 9, [
        q("SELECT camion_id, lat, lon, temp_camara, combustible_pct, CAST(alerta_ruptura_frio AS UNSIGNED) AS alerta FROM v_ultima_lectura")],
        fieldConfig={"defaults": {"thresholds": {"mode": "absolute", "steps": [{"color": "blue", "value": None}, {"color": "red", "value": 1}]}, "color": {"mode": "thresholds"}}, "overrides": []},
        options={"view": {"id": "coords", "lat": -38.9, "lon": -72.6, "zoom": 7}, "controls": {"showZoom": True},
            "basemap": {"type": "default", "name": "Mapa base"},
            "layers": [{"type": "markers", "name": "Camiones", "location": {"mode": "coords", "latitude": "lat", "longitude": "lon"},
                "config": {"showLegend": False, "style": {"size": {"fixed": 9}, "color": {"field": "alerta", "fixed": "blue"},
                    "text": {"field": "camion_id", "mode": "field"}, "textConfig": {"fontSize": 11, "offsetY": -14}}}}]}),
    panel("table", "Últimas alertas de ruptura de frío", 0, 22, 12, 8, [
        q("SELECT t.fecha_hora AS 'Fecha', t.camion_id AS 'Camión', t.temp_camara AS 'Temp °C', CONCAT(c.temp_min,' a ',c.temp_max) AS 'Rango permitido' "
          "FROM telemetria t JOIN camion c ON c.camion_id=t.camion_id WHERE t.alerta_ruptura_frio ORDER BY t.id_lectura DESC LIMIT 20")]),
    panel("bargauge", "Pipeline CRM: monto por etapa", 12, 22, 12, 8, [
        q("SELECT e.nombre AS etapa, COALESCE(SUM(o.monto_estimado),0) AS monto FROM etapa_pipeline e LEFT JOIN oportunidad o ON o.id_etapa=e.id_etapa GROUP BY e.id_etapa, e.nombre ORDER BY e.orden")],
        fieldConfig={"defaults": {"unit": "currencyUSD", "color": {"mode": "fixed", "fixedColor": "#ad1457"}}, "overrides": []},
        options={"orientation": "horizontal", "displayMode": "basic", "reduceOptions": {"values": True, "calcs": ["lastNotNull"], "fields": ""}}),
]
dash = {"uid": "cofrial-bi", "title": "Cofrial · BI comercial y cadena de frío", "tags": ["cofrial"], "timezone": "browser", "editable": True,
        "refresh": "5s", "time": {"from": "now-30m", "to": "now"}, "schemaVersion": 39, "version": 1, "panels": panels,
        "timepicker": {"refresh_intervals": ["5s", "10s", "30s", "1m"]}}
json.dump(dash, open("grafana/dashboards/cofrial.json", "w"), ensure_ascii=False, indent=1)
print(len(panels), "paneles")
