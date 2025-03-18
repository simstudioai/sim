FROM node:20-bullseye

# Avoid warnings by switching to noninteractive
ENV DEBIAN_FRONTEND=noninteractive

# Install necessary packages for development
RUN apt-get update \
    && apt-get -y install --no-install-recommends \
       git curl wget jq sudo postgresql-client \
    && apt-get clean -y \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user
ARG USERNAME=node
ARG USER_UID=1000
ARG USER_GID=$USER_UID

# Add sudo support
RUN echo "$USERNAME ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME

# Make sure we have the latest npm
RUN npm install -g npm@latest

# Install global packages
RUN npm install -g drizzle-kit

# Switch back to dialog for any ad-hoc use of apt-get
ENV DEBIAN_FRONTEND=dialog

WORKDIR /workspace

# Expose the ports we're interested in
EXPOSE 3000