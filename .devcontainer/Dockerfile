# Use the latest Bun canary image for development
FROM oven/bun:canary

# Avoid warnings by switching to noninteractive
ENV DEBIAN_FRONTEND=noninteractive

# Install necessary packages for development
RUN apt-get update \
    && apt-get -y install --no-install-recommends \
       git curl wget jq sudo postgresql-client vim nano \
       bash-completion ca-certificates lsb-release gnupg \
    && apt-get clean -y \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user
ARG USERNAME=bun
ARG USER_UID=1000
ARG USER_GID=$USER_UID

# Add sudo support
RUN echo "$USERNAME ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME

# Install global packages for development
RUN bun install -g turbo drizzle-kit typescript @types/node

# Install bun completions
RUN bun completions > /etc/bash_completion.d/bun

# Set up shell environment
RUN echo "export PATH=$PATH:/home/$USERNAME/.bun/bin" >> /etc/profile
RUN echo "source /etc/profile" >> /etc/bash.bashrc

# Switch back to dialog for any ad-hoc use of apt-get
ENV DEBIAN_FRONTEND=dialog

WORKDIR /workspace

# Expose the ports we're interested in
EXPOSE 3000
EXPOSE 3001
EXPOSE 3002