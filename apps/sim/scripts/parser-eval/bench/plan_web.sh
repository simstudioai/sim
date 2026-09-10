#!/bin/bash
# Builds lists/plan_web.tsv: IRS + government PDFs, slide-deck PDFs, HTML pages, CSV, JSON, YAML, MD, TXT.
BENCH="$(cd "$(dirname "$0")" && pwd)"; source "$BENCH/lib.sh"
L="$BENCH/lists"; P="$L/plan_web.tsv"; : > "$P"
add(){ printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$1" >> "$P"; }   # url ext name
raw(){ echo "https://raw.githubusercontent.com/$1/HEAD/$2"; }

# --- IRS forms & publications (25) ---
for f in f1040s1 f1040s2 f1040s3 f1040sa f1040sb f1040sc f1040sd f1040se f1099msc f1099nec f1099int f1099div p15 p334 p463 p501 p505 p523 p525 p526 p529 p535 p550 p554 p590a p596 p970 i1040gi; do add "https://www.irs.gov/pub/irs-pdf/$f.pdf" pdf "irs__$f.pdf"; done
# --- NIST / Federal Reserve (GAO and CBO return 403 to non-browser clients) ---
for f in SpecialPublications/NIST.SP.800-53r5 SpecialPublications/NIST.SP.800-63-3 SpecialPublications/NIST.SP.800-63b SpecialPublications/NIST.SP.800-171r3 SpecialPublications/NIST.SP.800-207 SpecialPublications/NIST.SP.800-61r3 SpecialPublications/NIST.SP.800-37r2 SpecialPublications/NIST.SP.800-88r2 SpecialPublications/NIST.SP.800-52r2 SpecialPublications/NIST.SP.800-90Ar1 SpecialPublications/NIST.SP.800-131Ar2 SpecialPublications/NIST.SP.800-218 FIPS/NIST.FIPS.140-3 FIPS/NIST.FIPS.197-upd1 FIPS/NIST.FIPS.180-4 ai/NIST.AI.100-1 CSWP/NIST.CSWP.29; do add "https://nvlpubs.nist.gov/nistpubs/$f.pdf" pdf "nist__$(basename $f).pdf"; done
for f in monetarypolicy/files/BeigeBook_20250115 monetarypolicy/files/fomcminutes20250129 publications/files/financial-stability-report-20250425 publications/files/2024-annual-report publications/files/2024-dfast-results-20240626 econres/feds/files/2024001pap econres/ifdp/files/ifdp1400; do add "https://www.federalreserve.gov/$f.pdf" pdf "fed__$(basename $f).pdf"; done
# --- slide decks exported to PDF (GitHub code search, filename:slides.pdf) ---
gh api -X GET search/code -f q='filename:slides.pdf' -f per_page=40 --jq '.items[] | .repository.full_name + "\t" + .path' 2>/dev/null | grep -i '\.pdf$' | head -22 | while IFS=$'\t' read -r repo path; do
  enc=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$path")
  name="slides__$(echo "${repo//\//_}_$(basename "$path")" | sed 's/[^A-Za-z0-9._-]/_/g')"
  add "https://media.githubusercontent.com/media/$repo/HEAD/$enc" pdf "$name"
done
# --- HTML: 25 Wikipedia, 10 MDN, 10 docs, 10 gov/news, 5 W3C ---
for t in Alan_Turing Photosynthesis Roman_Empire Quantum_mechanics Python_\(programming_language\) Bach Mount_Everest World_War_II Bitcoin DNA Tokyo Machine_learning Shakespeare Black_hole French_Revolution Amazon_rainforest Periodic_table Internet Chess Climate_change Mozart Great_Wall_of_China Antarctica Renaissance Coffee; do add "https://en.wikipedia.org/wiki/$t" html "wiki__$(echo $t | sed 's/[^A-Za-z0-9._-]/_/g').html"; done
for t in Web/JavaScript/Reference/Global_Objects/Array Web/JavaScript/Guide/Introduction Web/HTML/Element/table Web/CSS/CSS_grid_layout Web/API/Fetch_API/Using_Fetch Web/HTTP/Status/404 Web/JavaScript/Reference/Global_Objects/Promise Web/Accessibility/ARIA Web/CSS/flex Web/API/Web_Workers_API; do add "https://developer.mozilla.org/en-US/docs/$t" html "mdn__$(echo $t | tr '/' '_').html"; done
for u in https://docs.python.org/3/tutorial/introduction.html https://docs.python.org/3/library/json.html https://docs.python.org/3/library/asyncio.html https://docs.python.org/3/reference/datamodel.html https://react.dev/learn https://react.dev/reference/react/useState https://react.dev/learn/thinking-in-react https://kubernetes.io/docs/concepts/overview/ https://kubernetes.io/docs/concepts/workloads/pods/ https://kubernetes.io/docs/concepts/services-networking/service/; do add "$u" html "docs__$(echo "$u" | sed 's#https://##; s#/$##; s/[^A-Za-z0-9._-]/_/g').html"; done
for u in https://www.whitehouse.gov/ https://www.whitehouse.gov/administration/ https://www.nasa.gov/missions/ https://www.nasa.gov/humans-in-space/ https://science.nasa.gov/mars/ https://www.bbc.com/news https://www.bbc.com/news/science_and_environment https://www.bbc.com/sport https://www.usa.gov/ https://www.nist.gov/; do add "$u" html "gov__$(echo "$u" | sed 's#https://##; s#/$##; s/[^A-Za-z0-9._-]/_/g').html"; done
for u in https://www.w3.org/TR/WCAG21/ https://www.w3.org/TR/html-aria/ https://www.w3.org/TR/css-grid-1/ https://www.w3.org/TR/xml/ https://www.w3.org/TR/webauthn-2/; do add "$u" html "w3c__$(echo "$u" | sed 's#https://www.w3.org/TR/##; s#/$##').html"; done
# --- CSV: datasets org (under 5 MB) + semicolon/quoted samples ---
gh api repos/LibreOffice/core/contents/sc/qa/unit/data/csv --jq '.[] | select(.type=="file") | [.download_url, .name, (.size|tostring)] | @tsv' > "$L/lo_csv.tsv"
: > "$L/datasets_csv.tsv"
for r in covid-19 gdp population s-and-p-500 airport-codes country-codes cpi-us gold-prices oil-prices natural-gas co2-fossil-global house-prices-us bond-yields-us-10y exchange-rates world-cities inflation currency-codes language-codes nasdaq-listings finance-vix; do gh api repos/datasets/$r/contents/data --jq '.[] | select(.type=="file") | [.download_url, .name, (.size|tostring)] | @tsv' 2>/dev/null | sed "s#\t#\t${r}_#"; done >> "$L/datasets_csv.tsv"
awk -F'\t' '$2 ~ /\.csv$/ && $3+0 > 0 && $3 < 5000000' "$L/datasets_csv.tsv" | MAX_BYTES=5000000 pick csv 34 datasets >> "$P"
add "$(raw pandas-dev/pandas pandas/tests/io/data/csv/iris.csv)" csv "quoted__pandas_iris.csv"
add "$(raw tidyverse/readr inst/extdata/mtcars.csv)" csv "quoted__readr_mtcars.csv"
add "$(raw mwaskom/seaborn-data titanic.csv)" csv "quoted__seaborn_titanic.csv"
add "$(raw mwaskom/seaborn-data tips.csv)" csv "quoted__seaborn_tips.csv"
add "$(raw mafintosh/csv-parser test/fixtures/large-dataset.csv)" csv "quoted__csv-parser_large-dataset.csv"
add "$(raw pandas-dev/pandas pandas/tests/io/data/csv/banklist.csv)" csv "quoted__pandas_banklist.csv"
add "https://raw.githubusercontent.com/maxogden/csv-spectrum/master/csvs/comma_in_quotes.csv" csv "quoted__csv-spectrum_comma_in_quotes.csv"
add "https://raw.githubusercontent.com/maxogden/csv-spectrum/master/csvs/escaped_quotes.csv" csv "quoted__csv-spectrum_escaped_quotes.csv"
add "https://raw.githubusercontent.com/maxogden/csv-spectrum/master/csvs/newlines.csv" csv "quoted__csv-spectrum_newlines.csv"
add "https://raw.githubusercontent.com/maxogden/csv-spectrum/master/csvs/utf8.csv" csv "quoted__csv-spectrum_utf8.csv"
add "$(raw mafintosh/csv-parser test/fixtures/option-quote-escape.csv)" csv "quoted__csv-parser_option-quote-escape.csv"
add "$(raw mafintosh/csv-parser test/fixtures/backtick.csv)" csv "quoted__csv-parser_backtick.csv"
add "$(raw mafintosh/csv-parser test/fixtures/quotes+newlines.csv)" csv "quoted__csv-parser_quotes_newlines.csv"
add "$(raw mafintosh/csv-parser test/fixtures/comment.csv)" csv "quoted__csv-parser_comment.csv"
awk -F'\t' '$2 ~ /\.csv$/' "$L/lo_csv.tsv" | pick csv 8 lo >> "$P"
# --- MD: READMEs of 40 well-known repos ---
for r in facebook/react vuejs/core microsoft/vscode rust-lang/rust golang/go nodejs/node denoland/deno tensorflow/tensorflow pytorch/pytorch huggingface/transformers kubernetes/kubernetes docker/cli hashicorp/terraform ansible/ansible prettier/prettier eslint/eslint webpack/webpack vitejs/vite tailwindlabs/tailwindcss fastify/fastify pallets/flask rails/rails laravel/laravel redis/redis postgres/postgres sqlite/sqlite mongodb/mongo apache/kafka grafana/grafana prometheus/prometheus ohmyzsh/ohmyzsh neovim/neovim git/git curl/curl ollama/ollama langchain-ai/langchain; do add "$(raw $r README.md)" md "readme__${r//\//_}.md"; done
add "$(raw jgm/pandoc MANUAL.txt)" txt "manual__pandoc_MANUAL.txt"
# --- JSON: package.json / tsconfig / openapi specs / misc ---
for r in facebook/react vuejs/core microsoft/vscode vercel/next.js prettier/prettier eslint/eslint webpack/webpack vitejs/vite tailwindlabs/tailwindcss expressjs/express fastify/fastify sveltejs/svelte; do add "$(raw $r package.json)" json "package__${r//\//_}.json"; done
for r in vuejs/core vercel/next.js vitejs/vite prettier/prettier typescript-eslint/typescript-eslint; do add "$(raw $r tsconfig.json)" json "tsconfig__${r//\//_}.json"; done
add "$(raw OAI/learn.openapis.org examples/v3.0/petstore.json)" json "openapi__petstore.json"
add "$(raw OAI/learn.openapis.org examples/v3.0/petstore-expanded.json)" json "openapi__petstore-expanded.json"
add "$(raw OAI/learn.openapis.org examples/v3.0/uspto.json)" json "openapi__uspto.json"
add "$(raw OAI/learn.openapis.org examples/v3.0/api-with-examples.json)" json "openapi__api-with-examples.json"
add "$(raw OAI/learn.openapis.org examples/v3.0/link-example.json)" json "openapi__link-example.json"
add "$(raw OAI/learn.openapis.org examples/v2.0/json/petstore.json)" json "openapi__v2_petstore.json"
add "$(raw OAI/learn.openapis.org examples/v2.0/json/petstore-with-external-docs.json)" json "openapi__v2_petstore-with-external-docs.json"
add "$(raw json-schema-org/json-schema-spec package.json)" json "schema__json-schema-spec_schema.json"
add "$(raw SchemaStore/schemastore src/schemas/json/package.json)" json "schema__schemastore_package.json"
add "$(raw SchemaStore/schemastore src/schemas/json/tsconfig.json)" json "schema__schemastore_tsconfig.json"
add "$(raw SchemaStore/schemastore src/schemas/json/github-workflow.json)" json "schema__schemastore_github-workflow.json"
add "$(raw microsoft/vscode product.json)" json "misc__vscode_product.json"
add "$(raw nlohmann/json single_include/nlohmann/json.hpp)" txt "source__nlohmann_json_hpp.txt"
add "$(raw github/gitignore Node.gitignore)" txt "gitignore__Node.txt"
add "$(raw nlohmann/json_test_data json_tests/pass1.json)" json "misc__json_test_pass1.json"
add "$(raw jdorfman/awesome-json-datasets README.md)" md "readme__awesome-json-datasets.md"
add "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/ghec/ghec.json" json "openapi__github-rest-api-ghec.json"
add "$(raw stripe/openapi openapi/spec3.json)" json "openapi__stripe_spec3.json"
add "$(raw swagger-api/swagger-petstore src/main/resources/openapi.yaml)" yaml "openapi__swagger-petstore.yaml"
# --- YAML: GitHub Actions workflows, docker-compose, k8s manifests, openapi ---
for r in facebook/react:.github/workflows/compiler_typescript.yml vuejs/core:.github/workflows/ci.yml microsoft/vscode:.github/workflows/pr.yml nodejs/node:.github/workflows/test-linux.yml vercel/next.js:.github/workflows/build_and_test.yml prettier/prettier:.github/workflows/prod-test.yml eslint/eslint:.github/workflows/ci.yml vitejs/vite:.github/workflows/ci.yml tailwindlabs/tailwindcss:.github/workflows/ci.yml ollama/ollama:.github/workflows/test.yaml rust-lang/rust:.github/workflows/ci.yml grafana/grafana:.github/workflows/pr-checks.yml kubernetes/website:.github/workflows/netlify-periodic-build.yml pytorch/pytorch:.github/workflows/lint.yml huggingface/transformers:.github/workflows/build-docker-images.yml; do repo=${r%%:*}; path=${r#*:}; add "$(raw $repo $path)" yaml "workflow__${repo//\//_}_$(basename $path)"; done
for r in docker/awesome-compose:wordpress-mysql/compose.yaml docker/awesome-compose:react-express-mongodb/compose.yaml docker/awesome-compose:nginx-golang-postgres/compose.yaml docker/awesome-compose:prometheus-grafana/compose.yaml docker/awesome-compose:nextcloud-redis-mariadb/compose.yaml docker/awesome-compose:django/compose.yaml docker/awesome-compose:minecraft/compose.yaml; do repo=${r%%:*}; path=${r#*:}; add "$(raw $repo $path)" yaml "compose__$(echo $path | tr '/' '_')"; done
for p in application/deployment.yaml application/nginx-app.yaml controllers/nginx-deployment.yaml controllers/job.yaml controllers/daemonset.yaml application/web/web.yaml service/networking/ingress-wildcard-host.yaml pods/pod-with-node-affinity.yaml admin/namespace-dev.yaml policy/privileged-psp.yaml application/wordpress/mysql-deployment.yaml application/guestbook/frontend-deployment.yaml; do add "$(raw kubernetes/website content/en/examples/$p)" yaml "k8s__$(echo $p | tr '/' '_')"; done
add "$(raw OAI/learn.openapis.org examples/v3.0/petstore.yaml)" yaml "openapi__petstore.yaml"
add "$(raw OAI/learn.openapis.org examples/v3.0/uspto.yaml)" yaml "openapi__uspto.yaml"
add "$(raw OAI/learn.openapis.org examples/v3.0/callback-example.yaml)" yaml "openapi__callback-example.yaml"
add "$(raw helm/helm .github/workflows/build-test.yml)" yaml "workflow__helm_build-test.yml"
add "$(raw ansible/ansible .azure-pipelines/azure-pipelines.yml)" yaml "misc__ansible_azure-pipelines.yml"
add "$(raw prometheus/prometheus documentation/examples/prometheus-kubernetes.yml)" yaml "misc__prometheus-kubernetes.yml"
add "$(raw yaml/yaml-test-suite ReadMe.md)" md "readme__yaml-test-suite.md"
add "$(raw home-assistant/core .pre-commit-config.yaml)" yaml "misc__home-assistant_pre-commit.yaml"
# --- TXT: LICENSE / CHANGELOG-style / RFC / Gutenberg ---
for r in torvalds/linux:COPYING git/git:COPYING curl/curl:CHANGES.md:txt python/cpython:LICENSE nodejs/node:LICENSE golang/go:LICENSE rust-lang/rust:LICENSE-APACHE openssl/openssl:LICENSE.txt vim/vim:runtime/doc/uganda.txt neovim/neovim:runtime/doc/lua.txt sqlite/sqlite:VERSION microsoft/vscode:LICENSE.txt apache/httpd:CHANGES apache/httpd:LICENSE ImageMagick/ImageMagick:ChangeLogs/ChangeLog.md; do repo=${r%%:*}; rest=${r#*:}; path=${rest%%:*}; add "$(raw $repo $path)" txt "license__${repo//\//_}_$(basename $path | sed 's/\.md$//').txt"; done
for n in 2616 793 8259 7230 5321; do add "https://www.rfc-editor.org/rfc/rfc$n.txt" txt "rfc__rfc$n.txt"; done
for id in 1342 84 2701 11 1661 98 1400 2600 174 5200 17989 14591 8800 30254 27827; do add "https://www.gutenberg.org/cache/epub/$id/pg$id.txt" txt "gutenberg__pg$id.txt"; done
wc -l "$P"
