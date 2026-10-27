#!/bin/bash
# Prepara una EC2 con Amazon Linux 2023 para correr el proyecto Cofrial con Docker.
# Se puede pegar como "User data" al crear la instancia o ejecutar con:  sudo bash scripts/preparar-ec2.sh
set -euxo pipefail

dnf update -y
dnf install -y docker git mariadb105            # mariadb105 = cliente mysql para cargar la BD en RDS
systemctl enable --now docker
usermod -aG docker ec2-user                      # permite usar docker sin sudo (vuelve a conectarte por SSH)

# Plugins Docker Compose v2 y Buildx (necesarios para "docker compose up --build")
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
BUILDX=$(curl -fsSL https://api.github.com/repos/docker/buildx/releases/latest | grep -m1 '"tag_name"' | cut -d'"' -f4)
ARQ=$( [ "$(uname -m)" = "aarch64" ] && echo arm64 || echo amd64 )
curl -fsSL "https://github.com/docker/buildx/releases/download/${BUILDX}/buildx-${BUILDX}.linux-${ARQ}" \
  -o /usr/local/lib/docker/cli-plugins/docker-buildx
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose /usr/local/lib/docker/cli-plugins/docker-buildx

# 1 GB de swap: evita que una t2.micro se quede sin memoria al construir imágenes
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=1024
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo "/swapfile swap swap defaults 0 0" >> /etc/fstab
fi

docker --version && docker compose version
echo "EC2 lista para Cofrial"
