# Cofrial SpA · Hito 2: despliegue práctico en AWS Academy

Prototipo funcional del ecosistema diseñado en el Hito 1. Incluye:

- **E-commerce B2B/B2C:** catálogo de productos refrigerados con listas de precios por perfil, carrito de compras, checkout (orden de compra y crédito para B2B) y generación de órdenes.
- **CRM operativo:** clientes y prospectos, aprobación de cuentas B2B, pipeline Kanban, pedidos web con despacho y requerimientos.
- **IA de costo cero:** chat que clasifica requerimientos y les asigna prioridad. Funciona con Groq o Gemini (capas gratuitas) y tiene un clasificador local de respaldo.
- **Simulación IoT:** contenedores Docker (uno por camión) en una EC2 dedicada. Cada contenedor inserta cada 5 s en RDS `camion_id`, `temp_camara`, `lat`, `lon`, `combustible_pct` y `alerta_ruptura_frio`.
- **Business Intelligence en vivo:** dashboard en Grafana y panel BI dentro del CRM. Ambos cruzan las ventas (por día, canal y perfil) con las alertas de la cadena de frío.

```
Internet ──► EC2 Web (subred pública 10.0.1.0/24)
              ├─ contenedor app      :80   tienda + CRM + API + IA
              └─ contenedor grafana  :3000 dashboard BI
                         │ 3306
             Amazon RDS MySQL 8 (subredes privadas 10.0.11.0/24 y 10.0.12.0/24)
                         ▲ 3306
EC2 IoT (subred pública 10.0.2.0/24) ─ contenedores cam01 … cam05 (simulador.py)
```

## Estructura del proyecto

| Carpeta / archivo | Contenido |
| --- | --- |
| `db/01_schema.sql` | Esquema MySQL 8 en 3FN (29 tablas), igual al MER del Hito 1 |
| `db/02_seed.sql` | Datos de demostración: productos, listas de precios, clientes, 40 pedidos, 10 camiones y 14 días de telemetría (se regenera con `gen_seed.py`) |
| `db/03_views.sql` | Vistas para el BI: totales de pedido, ventas diarias, alertas diarias, cruce ventas vs. alertas y última lectura de cada camión |
| `app/` | Backend Node.js + Express, páginas de la tienda y del CRM, integración con IA (`ai.js`) |
| `iot/` | Simulador Python, Dockerfile y `docker-compose.yml` del nodo IoT |
| `grafana/` | Datasource y dashboard aprovisionados automáticamente |
| `docker-compose.yml` | Nodo Web: contenedores `app` y `grafana` |
| `scripts/` | `preparar-ec2.sh` (instala Docker), `cargar-bd.sh` (inicializa RDS), `verificar.sh` (chequeo de salud) |

## Credenciales de demostración

| Dónde | Usuario | Clave |
| --- | --- | --- |
| Tienda, cliente B2B (Institucional Salud) | compras@hospitalaraucania.cl | Cliente2026! |
| Tienda, cliente B2C | camila.rojas@mail.cl | Cliente2026! |
| CRM, vendedora | vendedor@cofrial.cl | Cofrial2026! |
| CRM, despacho / gerencia / admin | despacho@ · gerencia@ · admin@cofrial.cl | Cofrial2026! |
| Grafana | admin | valor de `GRAFANA_ADMIN_PASS` (por defecto Cofrial2026!) |

---

## Paso a paso en AWS Academy (Learner Lab)

> Inicia el laboratorio (**Start Lab**), espera a que el indicador quede en verde y abre la consola con **AWS**. Trabaja en la región **us-east-1 (N. Virginia)**.

### Paso 1. Crear la VPC (≈ 5 min)

1. Abre **VPC → Create VPC** y elige **VPC and more**.
2. Completa estos campos:
   - Name tag: `cofrial`
   - IPv4 CIDR: `10.0.0.0/16`
   - Number of AZs: **2**
   - Public subnets: **2**
   - Private subnets: **2**
   - NAT gateways: **None** (tiene costo por hora; así queda justificado en el Hito 1)
   - VPC endpoints: **None**
3. En **Customize subnets CIDR blocks** usa los rangos del Hito 1:
   - Públicas: `10.0.1.0/24` y `10.0.2.0/24`
   - Privadas: `10.0.11.0/24` y `10.0.12.0/24`
4. Presiona **Create VPC**. El asistente crea el Internet Gateway y las tablas de ruteo.
5. Abre **Subnets**, selecciona cada subred pública y activa **Edit subnet settings → Enable auto-assign public IPv4 address**.

### Paso 2. Security Groups (≈ 5 min)

En **VPC → Security groups → Create**, todos dentro de la VPC `cofrial-vpc`:

| Nombre | Reglas de entrada |
| --- | --- |
| `sg-web` | HTTP 80 desde 0.0.0.0/0 · TCP 3000 desde 0.0.0.0/0 (Grafana) · SSH 22 desde **My IP** |
| `sg-iot` | SSH 22 desde **My IP** (no recibe tráfico, solo envía) |
| `sg-rds` | MySQL/Aurora 3306 con origen **sg-web** · MySQL/Aurora 3306 con origen **sg-iot** |

La salida (outbound) queda abierta por defecto en los tres.

### Paso 3. Base de datos Amazon RDS (≈ 15 min, mientras tanto sigue con el paso 4)

1. Abre **RDS → Subnet groups → Create DB subnet group**.
   - Nombre: `cofrial-db-subnets`
   - VPC: `cofrial-vpc`
   - Subredes: las dos **privadas** (us-east-1a y us-east-1b)
2. Abre **RDS → Create database → Standard create** y configura:
   - Engine: **MySQL**. Usa la versión **8.0.x**, que trae autenticación compatible con el cliente de Amazon Linux.
   - Template: **Free tier**, o **Dev/Test** si Free tier no aparece.
   - DB instance identifier: `cofrial-db`
   - Master username: `admin`. Define una clave y anótala.
   - Instancia: `db.t3.micro` (o `db.t4g.micro`). Storage: 20 GB gp2/gp3, sin autoscaling.
   - Disponibilidad: **Single-AZ**. Es el trade-off documentado en el Hito 1.
   - Connectivity:
     - VPC: `cofrial-vpc`
     - Subnet group: `cofrial-db-subnets`
     - **Public access: No**
     - Security group: **sg-rds** (quita el default)
   - Additional configuration:
     - Backup retention: 7 días
     - Desactiva *Enhanced monitoring* si AWS Academy reclama permisos.
3. Cuando el estado sea **Available**, copia el **Endpoint** desde *Connectivity & security*.

### Paso 4. EC2 Web (≈ 5 min)

1. Abre **EC2 → Launch instance** y configura:
   - Nombre: `cofrial-web`
   - AMI: **Amazon Linux 2023**
   - Tipo: `t2.micro` (o `t3.small` si tu laboratorio lo permite; Grafana y la app corren más holgados).
   - Key pair: **vockey**. La descargas desde *AWS Details* del Learner Lab.
2. En **Network settings → Edit**:
   - VPC: `cofrial-vpc`
   - Subred: pública **us-east-1a**
   - Auto-assign public IP: Enable
   - Security group existente: **sg-web**
3. En **Advanced details**:
   - IAM instance profile: **LabInstanceProfile**
   - **User data:** pega el contenido de `scripts/preparar-ec2.sh`. Así Docker queda instalado solo.
4. Abre **Elastic IPs → Allocate** y asóciala a `cofrial-web`. Con eso la URL no cambia al reiniciar el laboratorio.

### Paso 5. EC2 IoT (≈ 3 min)

Igual que el paso 4, con estas diferencias:

- Nombre: `cofrial-iot`
- Subred: pública **us-east-1b**
- Security group: **sg-iot**
- Mismo *User data*

### Paso 6. Subir el código a las EC2

**Opción A, recomendada:** sube esta carpeta a un repositorio de GitHub del grupo y clónalo en cada EC2:

```bash
ssh -i labsuser.pem ec2-user@IP_EC2
git clone https://github.com/TU_USUARIO/cofrial-hito2.git
cd cofrial-hito2
```

**Opción B:** copia el zip desde tu computador:

```bash
scp -i labsuser.pem cofrial-hito2.zip ec2-user@IP_EC2:~
ssh -i labsuser.pem ec2-user@IP_EC2
unzip cofrial-hito2.zip && cd cofrial-hito2
```

Si usaste el *User data*, revisa que Docker esté listo con `docker compose version`. Si no lo usaste, ejecuta `sudo bash scripts/preparar-ec2.sh`, sal de SSH y vuelve a entrar.

### Paso 7. Inicializar la base de datos (en la EC2 Web)

```bash
cp .env.example .env
nano .env                  # DB_HOST = endpoint de RDS, DB_PASS = clave maestra, SESSION_SECRET = texto aleatorio
bash scripts/cargar-bd.sh  # crea cofrial_db con 29 tablas, datos demo y vistas
```

Si el script responde con 29 tablas, 16 productos, 9 clientes, 40 pedidos y 10 camiones, la conexión EC2 → RDS funciona y la seguridad está bien configurada.

### Paso 8. Levantar la tienda, el CRM y Grafana (en la EC2 Web)

```bash
docker compose up -d --build
bash scripts/verificar.sh
```

- Tienda: `http://ELASTIC_IP/`
- CRM: `http://ELASTIC_IP/crm`
- Grafana: `http://ELASTIC_IP:3000/` (abre el dashboard *Cofrial · BI comercial y cadena de frío*)

Los contenedores tienen `restart: always`, así que vuelven a levantarse solos cuando el laboratorio reinicia la EC2. Eso cumple el requisito de backend persistente.

### Paso 9. Encender la flota IoT (en la EC2 IoT)

```bash
cd cofrial-hito2/iot
cp .env.example .env
nano .env                  # mismo DB_HOST / DB_USER / DB_PASS de RDS
docker compose up -d --build
docker compose logs -f     # verás una línea por lectura de cada camión (Ctrl+C para salir)
```

En el CRM, la sección **Flota y cadena de frío** muestra el mapa y las temperaturas en vivo, y marca en rojo los camiones con alerta de ruptura de frío. `CAM-03` tiene mayor probabilidad de falla para que la demo muestre alertas. Para sumar camiones, copia una línea en `iot/docker-compose.yml` (CAM-06 a CAM-10 ya existen en la BD).

### Paso 10. Activar la IA gratuita

Sin clave, el chat usa el **clasificador local** y funciona igual en la demo. Para usar un modelo de lenguaje real:

1. Crea una clave gratuita:
   - **Groq:** https://console.groq.com/keys. Recomendado: el modelo `llama-3.1-8b-instant` tiene un límite diario holgado.
   - **Gemini:** https://aistudio.google.com/apikey (modelo `gemini-3.5-flash-lite`).
2. En el `.env` de la EC2 Web configura:
   ```
   AI_PROVIDER=groq
   AI_API_KEY=gsk_xxxxxxxxxxxxxxxx
   AI_MODEL=llama-3.1-8b-instant
   ```
3. Aplica el cambio con `docker compose up -d` (recrea solo la app).
4. Pruébalo: inicia sesión como cliente en la tienda, abre **Asistente IA** y escribe, por ejemplo, *"El pollo llegó blando y tibio"*. La respuesta muestra la categoría, la prioridad y el motor usado, y el caso aparece en **CRM → Requerimientos IA**.

Si la API falla o llega al límite gratuito, el sistema usa automáticamente el clasificador local, así que la demo no se cae. Los nombres de modelos gratuitos cambian seguido: si uno deja de existir, cámbialo en `AI_MODEL`.

---

## Guion sugerido para la defensa (≈ 7 minutos, sigue la rúbrica)

1. **Despliegue cloud.** Muestra en la consola AWS la VPC, las dos EC2 *running*, RDS *Available* con *Public access: No* y las reglas de `sg-rds`. Ejecuta `bash scripts/verificar.sh`.
2. **E-commerce B2C.** Sin sesión, navega el catálogo. Luego ingresa como `camila.rojas@mail.cl` y muestra el precio público.
3. **E-commerce B2B.** Cierra sesión e ingresa como `compras@hospitalaraucania.cl`. El precio cambia a la lista Institucional Salud. Agrega productos, pon una orden de compra y confirma el pedido.
4. **CRM.**
   - Entra en otra pestaña a `/crm` como vendedora.
   - En **Pedidos web**, el pedido recién creado aparece *Pendiente*. Pásalo a *En ruta*, asígnale el camión `CAM-03` y luego márcalo *Entregado*.
   - En la tienda, el cliente ve el estado en **Mis pedidos**.
5. **Registro B2B y pipeline.**
   - Registra una empresa nueva en `/cuenta` (perfil B2B). Queda *pendiente*.
   - En el CRM aparece como prospecto y en el pipeline. Apruébala desde su ficha, asignándole una lista de precios.
   - Cuando la empresa compre, la oportunidad pasa sola a *Ganada*.
6. **IoT.** En **Flota y cadena de frío**, muestra el mapa, las temperaturas y las alertas en vivo. En la EC2 IoT, ejecuta `docker compose ps` y `docker compose logs --tail 5`.
7. **BI.**
   - En el **Panel BI** del CRM o en Grafana, muestra el cruce de ventas diarias con alertas de frío, las ventas por canal (Web vs. CRM vs. Teléfono), B2B vs. B2C y las alertas por camión.
   - Destaca que el panel se actualiza solo.
8. **IA.** En el chat, escribe un reclamo de cadena de frío y muestra cómo aparece clasificado con prioridad alta en **Requerimientos IA**.

## Qué hacer cada vez que se inicia el laboratorio

1. Presiona **Start Lab** y espera el indicador verde. Las EC2 se encienden y los contenedores arrancan solos.
2. Revisa en la consola que RDS esté **Available** (puede tardar unos minutos en reanudarse).
3. Si RDS tardó más que los contenedores, la app reintenta sola. Si algo quedó caído, ejecuta `docker compose restart` en cada EC2.
4. Para dejar la demo como nueva antes de la defensa, ejecuta `bash scripts/cargar-bd.sh`. Recrea los datos de prueba.

## Solución de problemas

| Síntoma | Causa probable y solución |
| --- | --- |
| `cargar-bd.sh` queda colgado o da *Can't connect* | `sg-rds` no permite 3306 desde `sg-web`/`sg-iot`, o RDS no está *Available*. Revisa también que DB_HOST sea el endpoint y no el nombre. |
| `Authentication plugin 'caching_sha2_password'` | Usaste MySQL 8.4. Crea RDS con MySQL 8.0.x, o instala el cliente de MySQL en lugar de mariadb105. |
| `compose build requires buildx` | Ejecuta `sudo bash scripts/preparar-ec2.sh` (instala buildx) y vuelve a conectarte por SSH. |
| La página no abre desde el navegador | Falta la regla HTTP 80 o 3000 en `sg-web`, la subred no es pública o usas la IP privada. |
| Grafana muestra *datasource error* | El `.env` de la raíz debe tener DB_HOST/DB_PORT/DB_USER/DB_PASS/DB_NAME. Después ejecuta `docker compose up -d --force-recreate grafana`. |
| Horas desfasadas 3 horas | Todos los componentes usan `DB_TIMEZONE=-03:00`. No cambies la zona en un solo lugar. |
| El mapa del CRM sale gris | El navegador no pudo descargar los mosaicos de OpenStreetMap. Los datos y la tabla siguen funcionando. |
| La IA responde con "motor local (respaldo)" | La clave es inválida, se alcanzó el límite gratuito o el modelo cambió de nombre. Revisa `docker compose logs app`. |

## Evidencias sugeridas para el informe del Hito 2

1. **Consola AWS.** Captura estas pantallas:
   - Mapa de recursos de la VPC.
   - Subredes, tabla de ruteo con el IGW.
   - Reglas de los tres Security Groups.
   - RDS con *Public access: No*.
   - Las dos EC2 *running* con su Elastic IP.
2. **Terminal.** Captura:
   - `docker compose ps` en ambas EC2.
   - `docker compose logs` del simulador.
   - La salida de `scripts/verificar.sh`.
3. **Aplicación.** Captura:
   - Catálogo B2C y B2B, con precios distintos.
   - Carrito y confirmación del pedido.
   - Pipeline, pedidos y ficha de cliente en el CRM.
   - Flota con una alerta.
   - Panel BI y dashboard de Grafana.
   - Chat IA y requerimiento clasificado.

## Prueba local opcional (antes de ir a AWS)

Con Docker Desktop y una base MySQL 8 local:

1. Carga los tres scripts de `db/`.
2. Crea `.env` con `DB_HOST=host.docker.internal`.
3. Ejecuta `docker compose up --build`.
4. Abre `http://localhost`.
