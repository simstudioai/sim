# Third-Party Notices

Sim Studio is licensed under the Apache License 2.0. The distributed application
and container images also include third-party software under separate terms.
Those terms apply to the relevant third-party components and do not replace the
Sim Studio license.

## libheif-js and libheif

The HEIC decode and conversion path uses `libheif-js` 1.19.8 through
`heic-decode` and `heic-convert`. `libheif-js` is an Emscripten distribution of
libheif and declares the `LGPL-3.0` license.

- Packaged project and corresponding source:
  <https://github.com/catdad-experiments/libheif-js/tree/1.19.8>
- Upstream libheif project and source: <https://github.com/strukturag/libheif>
- License text shipped by the package: `node_modules/libheif-js/LICENSE` and
  `node_modules/libheif-js/libheif/LICENSE`

The application container copies the package's combined libheif license text to
`/app/third-party-licenses/libheif-LICENSE` so it remains available alongside
the distributed runtime.

## sharp-libvips and libvips

Image processing uses `sharp` with the platform-specific
`@img/sharp-libvips-*` 1.3.2 runtime package. That package declares
`LGPL-3.0-or-later` and bundles libvips 8.18.3 as a dynamically loaded shared
library. Its `versions.json` records the exact versions of libvips and the codec
libraries in each platform artifact; its `README.md` records their individual
license families. Both files are included in the application container with the
platform package.

- sharp-libvips build source:
  <https://github.com/lovell/sharp-libvips/tree/v1.3.2>
- libvips 8.18.3 corresponding source:
  <https://github.com/libvips/libvips/tree/v8.18.3>
- GNU Lesser General Public License 3.0:
  <https://www.gnu.org/licenses/lgpl-3.0.html>
- GNU General Public License 3.0, incorporated by LGPL 3.0:
  <https://www.gnu.org/licenses/gpl-3.0.html>

The complete platform-specific dependency and license table remains available
at `/app/node_modules/@img/sharp-libvips-*/README.md` in the application
container.
