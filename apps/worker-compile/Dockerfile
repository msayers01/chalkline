# syntax=docker/dockerfile:1
#
# Chalkline compile image: pinned TeX Live release, LuaLaTeX, latexmk and
# bubblewrap. Compile jobs run with no network, a read-only system and a
# per-job tmpfs directory (see src/runner.ts).
#
#   docker build -f apps/worker-compile/Dockerfile -t chalkline-compile .
#   docker build -f apps/worker-compile/Dockerfile --target matrix -t chalkline-matrix .
#
# Pin base images by digest in production (Renovate keeps them current).

FROM node:24-bookworm-slim AS compile
ARG TEXLIVE_REPOSITORY=https://mirror.ctan.org/systems/texlive/tlnet
RUN apt-get update \
 && apt-get install -y --no-install-recommends bubblewrap ca-certificates curl fontconfig perl xz-utils \
 && rm -rf /var/lib/apt/lists/*
COPY apps/worker-compile/toolchain/ /opt/chalkline-toolchain/
RUN TEXLIVE_REPOSITORY="$TEXLIVE_REPOSITORY" /opt/chalkline-toolchain/install-texlive.sh /opt/texlive
ENV PATH=/opt/texlive/2026/bin/x86_64-linux:$PATH \
    TEXLIVE_BIN=/opt/texlive/2026/bin/x86_64-linux
USER node
WORKDIR /home/node

# CI image for `pnpm compile-matrix`: adds Java, veraPDF and pnpm.
FROM compile AS matrix
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends default-jre-headless unzip \
 && rm -rf /var/lib/apt/lists/* \
 && /opt/chalkline-toolchain/install-verapdf.sh /opt/verapdf \
 && corepack enable
ENV VERAPDF=/opt/verapdf/verapdf
WORKDIR /repo
