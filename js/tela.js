/* Celular com "Site para computador" ligado: o navegador ignora a tag viewport e desenha a
   página com ~980px numa tela de ~400px, deixando tudo minúsculo. Este script detecta o caso,
   amplia a página para o tamanho real da tela e faz as regras @media do CSS responderem à
   largura real. É carregado no <head> logo depois do CSS, SEM defer: roda antes de a página
   aparecer (depois do CSS carregado). Usado pelo index.html e pelo catalogo.html. */
(function () {
  var root = document.documentElement;
  function matches(text, W, H) {
    return text.split(',').some(function (query) {
      return query.split(/\band\b/).every(function (part) {
        var m = part.match(/\(\s*([a-z-]+)\s*:\s*([^)]+)\)/);
        if (!m) return /^\s*(all|screen|only screen)?\s*$/.test(part);
        var f = m[1], v = m[2].trim(), n = parseFloat(v);
        if (f === 'min-width') return W >= n;
        if (f === 'max-width') return W <= n;
        if (f === 'min-height') return H >= n;
        if (f === 'max-height') return H <= n;
        if (f === 'orientation') return v === (H >= W ? 'portrait' : 'landscape');
        return window.matchMedia('(' + f + ': ' + v + ')').matches;
      });
    });
  }
  function fit() {
    var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    var sw = screen.width, iw = window.innerWidth;
    var z = coarse && sw > 0 && sw < 600 && iw > sw * 1.25 ? iw / sw : 1;
    root.style.zoom = z === 1 ? '' : z.toFixed(4);
    if (z === 1) { root.style.removeProperty('--vw'); root.style.removeProperty('--vh'); }
    else {
      root.style.setProperty('--vw', 'calc(1vw / ' + z.toFixed(4) + ')');
      root.style.setProperty('--vh', 'calc(1svh / ' + z.toFixed(4) + ')');
    }
    root.classList.toggle('fit-phone', z !== 1);
    var W = iw / z, H = window.innerHeight / z;
    [].forEach.call(document.styleSheets, function (sheet) {
      var rules;
      try { rules = sheet.cssRules; } catch (e) { return; } // folhas de outro domínio (Google Fonts)
      [].forEach.call(rules, function (rule) {
        if (!rule.media || !rule.cssRules) return;
        if (rule.vsOriginal === undefined) rule.vsOriginal = rule.media.mediaText;
        rule.media.mediaText = z === 1 ? rule.vsOriginal : (matches(rule.vsOriginal, W, H) ? 'all' : 'not all');
      });
    });
  }
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', function () { setTimeout(fit, 300); });
})();
