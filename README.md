# Cofrial SpA · Hito 2: despliegue en AWS Academy

Prototipo funcional del ecosistema digital de Cofrial SpA, distribuidora de alimentos refrigerados y congelados.

- **E-commerce B2B/B2C:** catálogo con listas de precios por perfil. Los clientes B2B compran con orden de compra y los B2C pagan con **Webpay Plus**.
- **CRM:** clientes y prospectos, aprobación de cuentas B2B, pipeline Kanban y pedidos con despacho.
- **IA:** chat que clasifica los mensajes de los clientes (Groq o Gemini, con un clasificador local de respaldo).
- **Gestión de casos:** cada mensaje es un caso con plazo según su prioridad. El ejecutivo ve la evidencia IoT del despacho y lo resuelve con reposición, reembolso o nota de crédito; el cliente califica la atención.
- **IoT:** un contenedor Docker por camión envía cada 5 s temperatura, ubicación, combustible y alerta de ruptura de frío a RDS.
- **BI en vivo:** Grafana y un panel en el CRM cruzan las ventas con las alertas de la cadena de frío.

```
Internet ──HTTPS 443──► EC2 Web (subred pública 10.0.1.0/24)
                         └─ caddy (HTTPS con Let's Encrypt)
                              ├─ app      tienda + CRM + API + IA   https://DOMINIO
                              └─ grafana  dashboard BI              https://grafana.DOMINIO
                         │ 3306
             Amazon RDS MySQL 8 (subredes privadas 10.0.11.0/24 y 10.0.12.0/24)
                         ▲ 3306
EC2 IoT (subred pública 10.0.2.0/24) ─ contenedores cam01 … cam05
```

## Estructura

| Carpeta / archivo | Contenido |
| --- | --- |
| `app/` | Backend Node.js + Express, tienda, CRM, IA (`ai.js`) y Webpay (`routes/pagos.js`) |
| `db/` | Esquema en 3FN (31 tablas), datos de demostración (`gen_seed.py`) y vistas para el BI |
| `iot/` | Simulador de camiones en Python y su `docker-compose.yml` |
| `grafana/` | Datasource y dashboard aprovisionados |
| `caddy/` | Proxy HTTPS (`Caddyfile`) |
| `docker-compose.yml` | Nodo Web: `caddy`, `app` y `grafana` |
| `scripts/` | `preparar-ec2.sh` (instala Docker), `cargar-bd.sh` (inicializa RDS), `verificar.sh` (chequeo) |
| `docs/MER.md` | Modelo entidad-relación |

## Cuentas de demostración

| Dónde | Usuario | Clave |
| --- | --- | --- |
| Tienda, cliente B2C | camila.rojas@mail.cl | Cliente2026! |
| Tienda, cliente B2B | compras@hospitalaraucania.cl | Cliente2026! |
| CRM | vendedor@cofrial.cl · despacho@ · gerencia@ · admin@cofrial.cl | Cofrial2026! |

Webpay usa el ambiente de pruebas de Transbank, sin dinero real. Tarjeta aprobada: VISA **4051 8856 0044 6623**, CVV 123, cualquier fecha futura. Tarjeta rechazada: Mastercard **5186 0595 5959 0568**. Autenticación: RUT **11.111.111-1**, clave **123**.

---

## Despliegue en AWS Academy

Región **us-east-1**. Inicia el laboratorio con **Start Lab** y espera el indicador verde.

**1. VPC.** *VPC → Create VPC → VPC and more:* nombre `cofrial`, CIDR `10.0.0.0/16`, 2 zonas, subredes públicas `10.0.1.0/24` y `10.0.2.0/24`, privadas `10.0.11.0/24` y `10.0.12.0/24`, sin NAT gateway. Activa *auto-assign public IPv4* en las dos públicas.

**2. Security Groups** (en `cofrial-vpc`):

| Nombre | Entrada |
| --- | --- |
| `sg-web` | HTTPS 443 y HTTP 80 desde 0.0.0.0/0 · SSH 22 desde *My IP* |
| `sg-iot` | SSH 22 desde *My IP* |
| `sg-rds` | MySQL 3306 desde `sg-web` y desde `sg-iot` |

El puerto 80 es necesario: Let's Encrypt valida el certificado por ahí y además redirige a HTTPS.

**3. RDS.** Crea un *DB subnet group* con las dos subredes privadas. Luego crea la base: MySQL **8.0.x**, `db.t3.micro`, Single-AZ, identificador `cofrial-db`, usuario `admin`, **Public access: No**, security group `sg-rds`. Copia el *Endpoint* cuando esté *Available*.

**4. EC2.** Crea dos instancias Amazon Linux 2023 con key pair `vockey`, perfil `LabInstanceProfile` y el contenido de `scripts/preparar-ec2.sh` como *User data*:
- `cofrial-web`: subred pública 1a, `sg-web`. Asóciale una **Elastic IP**.
- `cofrial-iot`: subred pública 1b, `sg-iot`.

**5. Código.** En cada EC2:
```bash
gh repo clone nelsito23pro/cofrial    # o git clone https://github.com/nelsito23pro/cofrial.git
cd cofrial
```

**6. Base de datos y nodo Web** (EC2 Web):
```bash
cp .env.example .env
nano .env                    # completa DB_HOST, DB_PASS, SESSION_SECRET, DOMINIO, GRAFANA_ADMIN_PASS y GRAFANA_DB_PASS
bash scripts/cargar-bd.sh    # 31 tablas, datos de demostración, vistas y usuario grafana_ro
docker compose up -d --build
bash scripts/verificar.sh
```
`DOMINIO` es la Elastic IP con guiones más `.sslip.io` (por ejemplo, `34-238-200-122.sslip.io`). Caddy obtiene y renueva solo el certificado HTTPS. Grafana se conecta con `grafana_ro`, un usuario de **solo lectura** limitado a las tablas del dashboard: no ve clientes ni usuarios y no puede modificar nada.

**7. Flota IoT** (EC2 IoT):
```bash
cd cofrial/iot
cp .env.example .env && nano .env    # mismo DB_HOST, DB_USER y DB_PASS de RDS
docker compose up -d --build
docker compose logs -f               # una línea por lectura de cada camión
```
CAM-03 falla más seguido para que haya alertas. Para sumar camiones, copia una línea en `iot/docker-compose.yml` (CAM-06 a CAM-10 ya existen en la base).

**8. IA (opcional).** Sin clave se usa el clasificador local. Con una clave gratuita de [Groq](https://console.groq.com/keys) o [Gemini](https://aistudio.google.com/apikey), configura en el `.env` de la EC2 Web `AI_PROVIDER`, `AI_API_KEY` y `AI_MODEL` (por defecto `openai/gpt-oss-20b` y `gemini-3.5-flash-lite`) y ejecuta `docker compose up -d`. `https://DOMINIO/api/health` muestra qué motor respondió el último mensaje.

**Al iniciar el laboratorio:** las EC2 y los contenedores arrancan solos (`restart: always`). Espera a que RDS esté *Available*. Para dejar la demo como nueva, ejecuta `bash scripts/cargar-bd.sh`.

## Solución de problemas

| Síntoma | Solución |
| --- | --- |
| `cargar-bd.sh` no conecta | RDS no está *Available* o `sg-rds` no permite 3306 desde `sg-web`/`sg-iot`. |
| `caching_sha2_password` | Crea RDS con MySQL 8.0.x. |
| `compose build requires buildx` | `sudo bash scripts/preparar-ec2.sh` y vuelve a entrar por SSH. |
| La página no abre | Faltan las reglas 443/80 en `sg-web` o usas la IP privada. |
| Certificado no válido | `docker compose logs caddy`: el puerto 80 debe estar abierto y `DOMINIO` debe coincidir con la Elastic IP. |
| Grafana: *datasource error* | Revisa `GRAFANA_DB_USER`/`GRAFANA_DB_PASS` (sin `$`), ejecuta `cargar-bd.sh` y luego `docker compose up -d --force-recreate grafana`. |
| Cambiar la clave de admin de Grafana | `docker compose exec grafana grafana cli admin reset-admin-password 'NUEVA_CLAVE'` |
| La IA dice "motor local (respaldo)" | Clave inválida, límite gratuito o modelo retirado: `docker compose logs app`. |
| El mapa del CRM sale gris | No cargaron los mosaicos de OpenStreetMap; los datos siguen funcionando. |
