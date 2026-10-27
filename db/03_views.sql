SET NAMES utf8mb4;
-- Vistas de apoyo para el CRM y el dashboard de BI
USE cofrial_db;

-- Total del pedido calculado (no se almacena: 3FN)
CREATE OR REPLACE VIEW v_pedido_total AS
SELECT p.id_pedido, p.fecha_pedido, p.id_cliente, c.nombre AS cliente, tc.nombre AS tipo_cliente,
       ca.nombre AS canal, ep.nombre AS estado, ep.orden AS estado_orden,
       SUM(d.cantidad * d.precio_unitario) AS total_neto,
       ROUND(SUM(d.cantidad * d.precio_unitario) * 1.19) AS total_con_iva
FROM pedido p
JOIN cliente c        ON c.id_cliente = p.id_cliente
JOIN tipo_cliente tc  ON tc.id_tipo = c.id_tipo
JOIN canal ca         ON ca.id_canal = p.id_canal
JOIN estado_pedido ep ON ep.id_estado_pedido = p.id_estado_pedido
JOIN detalle_pedido d ON d.id_pedido = p.id_pedido
GROUP BY p.id_pedido, p.fecha_pedido, p.id_cliente, c.nombre, tc.nombre, ca.nombre, ep.nombre, ep.orden;

-- Ventas por día (excluye cancelados)
CREATE OR REPLACE VIEW v_ventas_diarias AS
SELECT DATE(fecha_pedido) AS dia, COUNT(*) AS pedidos, SUM(total_neto) AS ventas_netas
FROM v_pedido_total WHERE estado <> 'Cancelado'
GROUP BY DATE(fecha_pedido);

-- Alertas de ruptura de frío por día
CREATE OR REPLACE VIEW v_alertas_diarias AS
SELECT DATE(fecha_hora) AS dia, SUM(alerta_ruptura_frio) AS alertas, COUNT(*) AS lecturas
FROM telemetria GROUP BY DATE(fecha_hora);

-- Cruce comercial + operativo (lo que pide la rúbrica del BI)
CREATE OR REPLACE VIEW v_ventas_vs_alertas AS
SELECT d.dia, COALESCE(v.pedidos,0) AS pedidos, COALESCE(v.ventas_netas,0) AS ventas_netas, COALESCE(a.alertas,0) AS alertas_frio
FROM (SELECT dia FROM v_ventas_diarias UNION SELECT dia FROM v_alertas_diarias) d
LEFT JOIN v_ventas_diarias v ON v.dia = d.dia
LEFT JOIN v_alertas_diarias a ON a.dia = d.dia;

-- Última lectura de cada camión (estado actual de la flota)
CREATE OR REPLACE VIEW v_ultima_lectura AS
SELECT t.* , c.temp_min, c.temp_max, c.patente
FROM telemetria t
JOIN (SELECT camion_id, MAX(id_lectura) AS ult FROM telemetria GROUP BY camion_id) u ON u.ult = t.id_lectura
JOIN camion c ON c.camion_id = t.camion_id;
