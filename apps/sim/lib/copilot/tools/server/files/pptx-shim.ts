/**
 * Runtime normalization shim for PptxGenJS option objects.
 *
 * PptxGenJS accepts model-natural input and silently corrupts the file or
 * ignores it: '#'-prefixed hex and 8-digit alpha hex corrupt the OOXML,
 * negative shadow offsets corrupt it, `letterSpacing` is silently ignored,
 * shared option objects are mutated in place (EMU-converted on first use),
 * bulleted run arrays merge into one paragraph without `breakLine`, and two
 * chart configurations produce decks PowerPoint refuses or discards. The
 * writing skill documents every one of these — this shim makes the corruption
 * classes impossible at author time instead of merely prompted against, so a
 * miss in the model's output degrades to a fixable error or a normalized
 * value, never a corrupt artifact.
 *
 * The snippet is pure ECMAScript with zero platform dependencies so the exact
 * same string runs inside the isolated-vm isolate (legacy path) and the doc
 * sandbox's Node process (E2B path). It patches the injected `globalThis.pptx`
 * instance and every slide it creates, and runs BEFORE any user code.
 */
export const PPTX_SHIM_JS = `
;(function () {
  var HEX_RE = /^#?[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function cloneDeep(v) {
    if (Array.isArray(v)) return v.map(cloneDeep);
    if (isPlainObject(v)) {
      var out = {};
      for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = cloneDeep(v[k]);
      return out;
    }
    return v;
  }

  function splitHex(value) {
    var hex = value.charAt(0) === '#' ? value.slice(1) : value;
    if (hex.length === 8) {
      return { hex: hex.slice(0, 6).toUpperCase(), alpha: parseInt(hex.slice(6), 16) };
    }
    return { hex: hex.toUpperCase(), alpha: null };
  }

  function isColorKey(key) {
    return /color/i.test(key);
  }

  // Normalizes one options tree in place (the tree is already a private clone).
  // parentKey names the property that held this node, so alpha channels land on
  // the right sibling: shadows take opacity (0-1), fills take transparency (0-100).
  function normalizeTree(node, parentKey) {
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) {
        if (typeof node[i] === 'string' && isColorKey(parentKey || '') && HEX_RE.test(node[i])) {
          node[i] = splitHex(node[i]).hex;
        } else {
          normalizeTree(node[i], parentKey);
        }
      }
      return;
    }
    if (!isPlainObject(node)) return;

    for (var key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      var value = node[key];

      if (typeof value === 'string' && HEX_RE.test(value)) {
        // Color strings appear under *color* keys and as the fill/line string
        // shorthand. Anything else ('text', 'name', ...) is left alone.
        if (isColorKey(key)) {
          var parts = splitHex(value);
          node[key] = parts.hex;
          if (parts.alpha !== null && parts.alpha !== 255) {
            if (parentKey === 'shadow') {
              if (node.opacity === undefined) node.opacity = Math.round((parts.alpha / 255) * 100) / 100;
            } else if (node.transparency === undefined) {
              node.transparency = Math.round((1 - parts.alpha / 255) * 100);
            }
          }
        } else if (key === 'fill' || key === 'line') {
          var fillParts = splitHex(value);
          var replacement = { color: fillParts.hex };
          if (fillParts.alpha !== null && fillParts.alpha !== 255) {
            replacement.transparency = Math.round((1 - fillParts.alpha / 255) * 100);
          }
          node[key] = replacement;
        }
        continue;
      }

      normalizeTree(value, key);
    }

    if (node.letterSpacing !== undefined && node.charSpacing === undefined) {
      node.charSpacing = node.letterSpacing;
    }
    if (node.letterSpacing !== undefined) delete node.letterSpacing;

    if (parentKey === 'shadow' && typeof node.offset === 'number' && node.offset < 0) {
      node.offset = -node.offset;
      node.angle = (((typeof node.angle === 'number' ? node.angle : 90) + 180) % 360 + 360) % 360;
    }
  }

  function normalizedOpts(opts) {
    if (!isPlainObject(opts)) return opts;
    var clone = cloneDeep(opts);
    normalizeTree(clone, '');
    return clone;
  }

  // Bulleted run arrays: without breakLine each run lands in ONE paragraph and
  // the deck shows concatenated text behind a single bullet. Rich-text arrays
  // (no bullet flags) merge runs intentionally and are left alone.
  function normalizedTextArg(text) {
    if (!Array.isArray(text)) return text;
    var items = text.map(cloneDeep);
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!isPlainObject(item)) continue;
      if (isPlainObject(item.options)) {
        normalizeTree(item.options, '');
        if (i < items.length - 1 && item.options.bullet && item.options.breakLine === undefined) {
          item.options.breakLine = true;
        }
      }
    }
    return items;
  }

  var STACKED = { stacked: true, percentStacked: true };

  function guardChartOptions(opts) {
    if (!isPlainObject(opts)) return;
    if (STACKED[opts.barGrouping] && opts.dataLabelPosition === 'outEnd') {
      throw new Error(
        "addChart: dataLabelPosition 'outEnd' on a " + opts.barGrouping +
        " chart makes PowerPoint report the file as corrupt — use 'ctr', 'inEnd', or 'inBase'"
      );
    }
  }

  function guardComboChart(series, opts) {
    var usesSecondary = false;
    for (var i = 0; i < series.length; i++) {
      var so = series[i] && series[i].options;
      if (so && (so.secondaryValAxis || so.secondaryCatAxis)) usesSecondary = true;
    }
    if (!usesSecondary) return;
    var ok = isPlainObject(opts) &&
      Array.isArray(opts.valAxes) && opts.valAxes.length >= 2 &&
      Array.isArray(opts.catAxes) && opts.catAxes.length >= 2;
    if (!ok) {
      throw new Error(
        'addChart: a combo series using secondaryValAxis/secondaryCatAxis needs BOTH valAxes and ' +
        'catAxes on the chart options (two entries each), or PowerPoint silently discards the chart'
      );
    }
  }

  function wrapSlide(slide) {
    var addText = slide.addText.bind(slide);
    var addShape = slide.addShape.bind(slide);
    var addTable = slide.addTable.bind(slide);
    var addChart = slide.addChart.bind(slide);
    var addImage = slide.addImage.bind(slide);

    slide.addText = function (text, opts) {
      var normalized = normalizedOpts(opts);
      if (isPlainObject(normalized) && normalized.fit === undefined && normalized.autoFit === undefined) {
        normalized.fit = 'shrink';
      }
      return addText(normalizedTextArg(text), normalized);
    };
    slide.addShape = function (type, opts) {
      return addShape(type, normalizedOpts(opts));
    };
    slide.addTable = function (rows, opts) {
      var cloned = Array.isArray(rows)
        ? rows.map(function (row) {
            if (!Array.isArray(row)) return cloneDeep(row);
            return row.map(function (cell) {
              var c = cloneDeep(cell);
              if (isPlainObject(c) && isPlainObject(c.options)) normalizeTree(c.options, '');
              return c;
            });
          })
        : rows;
      return addTable(cloned, normalizedOpts(opts));
    };
    slide.addChart = function (typeOrSeries, dataOrOpts, opts) {
      if (Array.isArray(typeOrSeries)) {
        var comboOpts = normalizedOpts(dataOrOpts);
        guardComboChart(typeOrSeries, comboOpts);
        guardChartOptions(comboOpts);
        return addChart(typeOrSeries.map(cloneDeep), comboOpts);
      }
      var chartOpts = normalizedOpts(opts);
      guardChartOptions(chartOpts);
      return addChart(typeOrSeries, cloneDeep(dataOrOpts), chartOpts);
    };
    slide.addImage = function (opts) {
      return addImage(normalizedOpts(opts));
    };
    return slide;
  }

  var pptx = globalThis.pptx;
  if (!pptx) return;
  var addSlide = pptx.addSlide.bind(pptx);
  pptx.addSlide = function (opts) {
    return wrapSlide(addSlide(typeof opts === 'string' ? opts : normalizedOpts(opts)));
  };
  var defineSlideMaster = pptx.defineSlideMaster.bind(pptx);
  pptx.defineSlideMaster = function (opts) {
    return defineSlideMaster(normalizedOpts(opts));
  };
})();
`.trim()
