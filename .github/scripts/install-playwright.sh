#!/usr/bin/env bash
# The dependency dry run uses the pinned driver's package list without updating apt.
#
# PLAYWRIGHT_APT_CACHE names a directory of .deb files kept between runs (the workflow restores it
# per runner image and browser set). With it, missing system libraries install from those files
# without reaching an Ubuntu mirror, whose stalls have held a suite in this step for 16 minutes.
# A cold or incomplete cache falls back to `install-deps`, then stores what apt downloaded and
# writes `$cache/.updated`, which tells the workflow to save the cache under a new key.
set -euo pipefail

started=$SECONDS

browsers=()
for argument in "$@"; do
  case "$argument" in
    --only-shell|--no-shell) ;;
    *) browsers+=("$argument") ;;
  esac
done

deps_present() {
  bunx --no-install playwright install-deps --dry-run "${browsers[@]}" > /dev/null 2>&1
}

# Installs only from the cached files; anything apt would still fetch fails it instead.
install_from_cache() {
  [ -n "$cache" ] && compgen -G "$cache/*.deb" > /dev/null || return 1
  local output
  if ! output=$(sudo apt-get install -y --no-install-recommends --no-download "$cache"/*.deb 2>&1); then
    printf '%s\n' "$output" | tail -n 5 | sed 's/^/Cache install failed: /'
    return 1
  fi
  deps_present
}

cache=${PLAYWRIGHT_APT_CACHE:-}
if ! deps_present; then
  if install_from_cache; then
    echo "Installed system dependencies from $cache"
  else
    bunx --no-install playwright install-deps "${browsers[@]}"
    if [ -n "$cache" ] && compgen -G '/var/cache/apt/archives/*.deb' > /dev/null; then
      mkdir -p "$cache"
      cp /var/cache/apt/archives/*.deb "$cache"/
      touch "$cache/.updated"
      echo "Stored $(find "$cache" -name '*.deb' | wc -l) packages in $cache"
    elif [ -n "$cache" ]; then
      echo "::warning::apt kept no downloaded packages; nothing to cache for the next run."
    fi
  fi
fi
bunx --no-install playwright install "$@"
echo "Browser install took $((SECONDS - started))s"
