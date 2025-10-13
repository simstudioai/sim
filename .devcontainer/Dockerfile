FROM oven/bun:1.2.22-alpine

# Install necessary packages for development
RUN apk add --no-cache \
    git \
    curl \
    wget \
    jq \
    sudo \
    postgresql-client \
    vim \
    nano \
    bash \
    bash-completion \
    zsh \
    zsh-vcs \
    ca-certificates \
    shadow

# Create a non-root user with matching UID/GID
ARG USERNAME=bun
ARG USER_UID=1000
ARG USER_GID=$USER_UID

# Create user group if it doesn't exist
RUN if ! getent group $USER_GID >/dev/null; then \
        addgroup -g $USER_GID $USERNAME; \
    fi

# Create user if it doesn't exist
RUN if ! getent passwd $USER_UID >/dev/null; then \
        adduser -D -u $USER_UID -G $(getent group $USER_GID | cut -d: -f1) $USERNAME; \
    fi

# Add sudo support
RUN echo "$USERNAME ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME

# Set up shell environment
RUN echo "export PATH=\$PATH:/home/$USERNAME/.bun/bin" >> /etc/profile

WORKDIR /workspace

# Expose the ports we're interested in
EXPOSE 3000
EXPOSE 3001
EXPOSE 3002