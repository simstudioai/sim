FROM node:20-bullseye

# Avoid warnings by switching to noninteractive
ENV DEBIAN_FRONTEND=noninteractive

# Configure apt and install packages
RUN apt-get update \
    && apt-get -y install --no-install-recommends apt-utils dialog 2>&1 \
    # Install git, process tools, lsb-release
    && apt-get -y install git procps lsb-release \
    # Install other dependencies
    && apt-get -y install curl wget jq sudo \
    # Clean up
    && apt-get autoremove -y \
    && apt-get clean -y \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user
ARG USERNAME=node
ARG USER_UID=1000
ARG USER_GID=$USER_UID

# [Optional] Add sudo support
RUN apt-get update \
    && apt-get install -y sudo \
    && echo $USERNAME ALL=\(root\) NOPASSWD:ALL > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME

# Make sure we have the latest npm
RUN npm install -g npm@latest

# Install global packages
RUN npm install -g drizzle-kit

# Install dependencies for Postgres client
RUN apt-get update && apt-get -y install --no-install-recommends \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Switch back to dialog for any ad-hoc use of apt-get
ENV DEBIAN_FRONTEND=dialog

WORKDIR /workspace

# Expose the ports we're interested in
EXPOSE 3000 