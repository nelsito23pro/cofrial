SET NAMES utf8mb4;
-- =====================================================================
-- Cofrial SpA · Base de datos cofrial_db (MySQL 8 / Amazon RDS)
-- Modelo en 3FN: Seguridad, Geografía, Comercial, Catálogo/Inventario,
-- E-commerce, CRM, Logística e IoT  (29 tablas)
-- =====================================================================
-- ATENCIÓN: este script recrea la base desde cero (borra los datos existentes).
DROP DATABASE IF EXISTS cofrial_db;
CREATE DATABASE cofrial_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cofrial_db;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------- Seguridad ----------
CREATE TABLE rol (
  id_rol INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(30) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE usuario (
  id_usuario INT AUTO_INCREMENT PRIMARY KEY,
  id_rol INT NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_usuario_rol FOREIGN KEY (id_rol) REFERENCES rol(id_rol)
) ENGINE=InnoDB;

-- ---------- Geografía ----------
CREATE TABLE region (
  id_region INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(60) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE comuna (
  id_comuna INT AUTO_INCREMENT PRIMARY KEY,
  id_region INT NOT NULL,
  nombre VARCHAR(60) NOT NULL,
  CONSTRAINT fk_comuna_region FOREIGN KEY (id_region) REFERENCES region(id_region)
) ENGINE=InnoDB;

-- ---------- Comercial ----------
CREATE TABLE tipo_cliente (
  id_tipo INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(10) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE estado_cliente (
  id_estado_cliente INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(20) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE lista_precio (
  id_lista INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(60) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE cliente (
  id_cliente INT AUTO_INCREMENT PRIMARY KEY,
  id_tipo INT NOT NULL,
  id_estado_cliente INT NOT NULL,
  id_lista INT NOT NULL,
  id_vendedor INT NULL,
  rut VARCHAR(12) NULL UNIQUE,
  nombre VARCHAR(150) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  telefono VARCHAR(20) NULL,
  password_hash VARCHAR(255) NULL,
  fecha_registro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cliente_tipo FOREIGN KEY (id_tipo) REFERENCES tipo_cliente(id_tipo),
  CONSTRAINT fk_cliente_estado FOREIGN KEY (id_estado_cliente) REFERENCES estado_cliente(id_estado_cliente),
  CONSTRAINT fk_cliente_lista FOREIGN KEY (id_lista) REFERENCES lista_precio(id_lista),
  CONSTRAINT fk_cliente_vendedor FOREIGN KEY (id_vendedor) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB;

CREATE TABLE direccion (
  id_direccion INT AUTO_INCREMENT PRIMARY KEY,
  id_cliente INT NOT NULL,
  id_comuna INT NOT NULL,
  calle VARCHAR(120) NOT NULL,
  numero VARCHAR(10) NULL,
  referencia VARCHAR(200) NULL,
  CONSTRAINT fk_direccion_cliente FOREIGN KEY (id_cliente) REFERENCES cliente(id_cliente),
  CONSTRAINT fk_direccion_comuna FOREIGN KEY (id_comuna) REFERENCES comuna(id_comuna)
) ENGINE=InnoDB;

-- ---------- Catálogo e inventario ----------
CREATE TABLE categoria (
  id_categoria INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(60) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE producto (
  id_producto INT AUTO_INCREMENT PRIMARY KEY,
  id_categoria INT NOT NULL,
  sku VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(120) NOT NULL,
  descripcion TEXT NULL,
  unidad VARCHAR(10) NOT NULL,
  temp_min DECIMAL(5,2) NOT NULL,
  temp_max DECIMAL(5,2) NOT NULL,
  imagen_url VARCHAR(255) NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_producto_categoria FOREIGN KEY (id_categoria) REFERENCES categoria(id_categoria),
  CONSTRAINT ck_producto_temp CHECK (temp_min <= temp_max)
) ENGINE=InnoDB;

CREATE TABLE precio_producto (
  id_lista INT NOT NULL,
  id_producto INT NOT NULL,
  precio DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id_lista, id_producto),
  CONSTRAINT fk_pp_lista FOREIGN KEY (id_lista) REFERENCES lista_precio(id_lista),
  CONSTRAINT fk_pp_producto FOREIGN KEY (id_producto) REFERENCES producto(id_producto),
  CONSTRAINT ck_pp_precio CHECK (precio > 0)
) ENGINE=InnoDB;

CREATE TABLE bodega (
  id_bodega INT AUTO_INCREMENT PRIMARY KEY,
  id_comuna INT NOT NULL,
  nombre VARCHAR(60) NOT NULL,
  CONSTRAINT fk_bodega_comuna FOREIGN KEY (id_comuna) REFERENCES comuna(id_comuna)
) ENGINE=InnoDB;

CREATE TABLE inventario (
  id_bodega INT NOT NULL,
  id_producto INT NOT NULL,
  stock_actual DECIMAL(12,2) NOT NULL,
  stock_minimo DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id_bodega, id_producto),
  CONSTRAINT fk_inv_bodega FOREIGN KEY (id_bodega) REFERENCES bodega(id_bodega),
  CONSTRAINT fk_inv_producto FOREIGN KEY (id_producto) REFERENCES producto(id_producto),
  CONSTRAINT ck_inv_stock CHECK (stock_actual >= 0)
) ENGINE=InnoDB;

-- ---------- E-commerce ----------
CREATE TABLE canal (
  id_canal INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(30) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE estado_pedido (
  id_estado_pedido INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(30) NOT NULL UNIQUE,
  orden INT NOT NULL
) ENGINE=InnoDB;

CREATE TABLE pedido (
  id_pedido INT AUTO_INCREMENT PRIMARY KEY,
  id_cliente INT NOT NULL,
  id_direccion INT NOT NULL,
  id_canal INT NOT NULL,
  id_estado_pedido INT NOT NULL,
  fecha_pedido DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  observacion VARCHAR(255) NULL,
  CONSTRAINT fk_pedido_cliente FOREIGN KEY (id_cliente) REFERENCES cliente(id_cliente),
  CONSTRAINT fk_pedido_direccion FOREIGN KEY (id_direccion) REFERENCES direccion(id_direccion),
  CONSTRAINT fk_pedido_canal FOREIGN KEY (id_canal) REFERENCES canal(id_canal),
  CONSTRAINT fk_pedido_estado FOREIGN KEY (id_estado_pedido) REFERENCES estado_pedido(id_estado_pedido),
  INDEX ix_pedido_fecha (fecha_pedido)
) ENGINE=InnoDB;

CREATE TABLE detalle_pedido (
  id_pedido INT NOT NULL,
  id_producto INT NOT NULL,
  cantidad DECIMAL(10,2) NOT NULL,
  precio_unitario DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id_pedido, id_producto),
  CONSTRAINT fk_det_pedido FOREIGN KEY (id_pedido) REFERENCES pedido(id_pedido),
  CONSTRAINT fk_det_producto FOREIGN KEY (id_producto) REFERENCES producto(id_producto),
  CONSTRAINT ck_det_cantidad CHECK (cantidad > 0)
) ENGINE=InnoDB;

-- ---------- CRM ----------
CREATE TABLE etapa_pipeline (
  id_etapa INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(30) NOT NULL UNIQUE,
  orden INT NOT NULL,
  probabilidad_pct TINYINT NOT NULL,
  CONSTRAINT ck_etapa_prob CHECK (probabilidad_pct BETWEEN 0 AND 100)
) ENGINE=InnoDB;

CREATE TABLE oportunidad (
  id_oportunidad INT AUTO_INCREMENT PRIMARY KEY,
  id_cliente INT NOT NULL,
  id_usuario INT NOT NULL,
  id_etapa INT NOT NULL,
  id_pedido INT NULL UNIQUE,
  titulo VARCHAR(120) NOT NULL,
  monto_estimado DECIMAL(12,2) NULL,
  fecha_apertura DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_cierre DATETIME NULL,
  CONSTRAINT fk_op_cliente FOREIGN KEY (id_cliente) REFERENCES cliente(id_cliente),
  CONSTRAINT fk_op_usuario FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario),
  CONSTRAINT fk_op_etapa FOREIGN KEY (id_etapa) REFERENCES etapa_pipeline(id_etapa),
  CONSTRAINT fk_op_pedido FOREIGN KEY (id_pedido) REFERENCES pedido(id_pedido)
) ENGINE=InnoDB;

CREATE TABLE tipo_interaccion (
  id_tipo_interaccion INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(30) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE interaccion (
  id_interaccion INT AUTO_INCREMENT PRIMARY KEY,
  id_cliente INT NOT NULL,
  id_usuario INT NULL,
  id_tipo_interaccion INT NOT NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  detalle TEXT NULL,
  CONSTRAINT fk_int_cliente FOREIGN KEY (id_cliente) REFERENCES cliente(id_cliente),
  CONSTRAINT fk_int_usuario FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario),
  CONSTRAINT fk_int_tipo FOREIGN KEY (id_tipo_interaccion) REFERENCES tipo_interaccion(id_tipo_interaccion)
) ENGINE=InnoDB;

CREATE TABLE categoria_requerimiento (
  id_categoria_req INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(40) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE requerimiento (
  id_requerimiento INT AUTO_INCREMENT PRIMARY KEY,
  id_cliente INT NOT NULL,
  id_pedido INT NULL,
  id_categoria_req INT NULL,
  mensaje TEXT NOT NULL,
  respuesta_ia TEXT NULL,
  prioridad TINYINT NULL,
  resuelto BOOLEAN NOT NULL DEFAULT FALSE,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_req_cliente FOREIGN KEY (id_cliente) REFERENCES cliente(id_cliente),
  CONSTRAINT fk_req_pedido FOREIGN KEY (id_pedido) REFERENCES pedido(id_pedido),
  CONSTRAINT fk_req_categoria FOREIGN KEY (id_categoria_req) REFERENCES categoria_requerimiento(id_categoria_req),
  CONSTRAINT ck_req_prioridad CHECK (prioridad BETWEEN 1 AND 3)
) ENGINE=InnoDB;

-- ---------- Logística e IoT ----------
CREATE TABLE camion (
  camion_id VARCHAR(10) PRIMARY KEY,
  patente VARCHAR(8) NOT NULL UNIQUE,
  capacidad_kg INT NULL,
  temp_min DECIMAL(5,2) NOT NULL,
  temp_max DECIMAL(5,2) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT ck_camion_temp CHECK (temp_min <= temp_max)
) ENGINE=InnoDB;

CREATE TABLE conductor (
  id_conductor INT AUTO_INCREMENT PRIMARY KEY,
  rut VARCHAR(12) NOT NULL UNIQUE,
  nombre VARCHAR(100) NOT NULL,
  telefono VARCHAR(20) NULL
) ENGINE=InnoDB;

CREATE TABLE despacho (
  id_despacho INT AUTO_INCREMENT PRIMARY KEY,
  camion_id VARCHAR(10) NOT NULL,
  id_conductor INT NOT NULL,
  fecha_salida DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_llegada DATETIME NULL,
  CONSTRAINT fk_desp_camion FOREIGN KEY (camion_id) REFERENCES camion(camion_id),
  CONSTRAINT fk_desp_conductor FOREIGN KEY (id_conductor) REFERENCES conductor(id_conductor)
) ENGINE=InnoDB;

CREATE TABLE despacho_pedido (
  id_despacho INT NOT NULL,
  id_pedido INT NOT NULL,
  orden_entrega INT NOT NULL,
  fecha_entrega DATETIME NULL,
  PRIMARY KEY (id_despacho, id_pedido),
  CONSTRAINT fk_dp_despacho FOREIGN KEY (id_despacho) REFERENCES despacho(id_despacho),
  CONSTRAINT fk_dp_pedido FOREIGN KEY (id_pedido) REFERENCES pedido(id_pedido)
) ENGINE=InnoDB;

CREATE TABLE telemetria (
  id_lectura BIGINT AUTO_INCREMENT PRIMARY KEY,
  camion_id VARCHAR(10) NOT NULL,
  fecha_hora DATETIME NOT NULL,
  temp_camara DECIMAL(5,2) NOT NULL,
  lat DECIMAL(9,6) NOT NULL,
  lon DECIMAL(9,6) NOT NULL,          -- "long" es palabra reservada en MySQL
  combustible_pct TINYINT NOT NULL,
  alerta_ruptura_frio BOOLEAN NOT NULL,
  CONSTRAINT fk_tel_camion FOREIGN KEY (camion_id) REFERENCES camion(camion_id),
  CONSTRAINT ck_tel_combustible CHECK (combustible_pct BETWEEN 0 AND 100),
  INDEX ix_tel_camion_fecha (camion_id, fecha_hora),
  INDEX ix_tel_fecha (fecha_hora)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;
