/* Simulazione dimostrativa del sito ZenCar: settimana di ESEMPIO, dati inventati e dichiarati come tali.
   È volutamente semplice e usa solo le regole che ZenCar dichiara in pubblico: cinque fasi in ordine, capacità letta
   per reparto, al massimo 8 ore al giorno per vettura, precedenza a urgenti e consegna più vicina. Il motore vero
   del planner (secondarie, essiccazione, assenze per operaio, chiusura automatica...) non è qui: resta sul server. */
(function (radice) {
  'use strict';
  var FASI = [
    { k: 'sta', nome: 'Stacco', rep: 'sr' },
    { k: 'lat', nome: 'Lattoneria', rep: 'lat' },
    { k: 'pv', nome: 'Verniciatura', rep: 'pv' },
    { k: 'ria', nome: 'Riattacco', rep: 'sr' },
    { k: 'luc', nome: 'Lucidatura', rep: 'luc' }
  ];
  var REPARTI = [
    { k: 'sr', nome: 'Stacco/riattacco' }, { k: 'lat', nome: 'Lattoneria' },
    { k: 'pv', nome: 'Verniciatura' }, { k: 'luc', nome: 'Lucidatura' }
  ];
  // dieci giorni lavorativi di esempio: da lunedì 2 a venerdì 13 novembre 2026
  var GIORNI = [
    ['2026-11-02', 'Lun', 2], ['2026-11-03', 'Mar', 3], ['2026-11-04', 'Mer', 4], ['2026-11-05', 'Gio', 5], ['2026-11-06', 'Ven', 6],
    ['2026-11-09', 'Lun', 9], ['2026-11-10', 'Mar', 10], ['2026-11-11', 'Mer', 11], ['2026-11-12', 'Gio', 12], ['2026-11-13', 'Ven', 13]
  ].map(function (g, i) { return { i: i, data: g[0], nome: g[1], num: g[2], breve: g[1] + ' ' + g[2] }; });
  var MAX_VETTURA = 8;
  // squadra di esempio: due operai per reparto, uno in lucidatura, 8 ore ciascuno
  function capacita(assenze) {
    return GIORNI.map(function (g) {
      var c = { sr: 16, lat: 16, pv: 16, luc: 8 };
      (assenze || []).forEach(function (a) { if (g.i >= a.dal && g.i <= a.al) c[a.rep] -= 8; });
      return c;
    });
  }
  // vetture: ore per fase [sta, lat, pv, ria, luc], indice del giorno di ingresso e di consegna
  function piano(vetture, assenze) {
    var cap = capacita(assenze);
    var ordine = vetture.slice().sort(function (a, b) {
      return (b.urgente ? 1 : 0) - (a.urgente ? 1 : 0) || a.consegna - b.consegna || a.ingresso - b.ingresso;
    });
    var esito = {}, uso = GIORNI.map(function () { return { sr: 0, lat: 0, pv: 0, luc: 0 }; });
    ordine.forEach(function (v) {
      var fase = 0, resto = v.ore.slice(), blocchi = [], fine = null, attese = [0, 0, 0, 0, 0];
      while (fase < 5 && resto[fase] <= 0) fase++;
      for (var d = v.ingresso; d < GIORNI.length && fase < 5; d++) {
        var libere = MAX_VETTURA;
        while (fase < 5 && libere > 0) {
          var rep = FASI[fase].rep, disp = cap[d][rep] - uso[d][rep];
          if (disp <= 0) { attese[fase] += libere; break; } // il reparto è al completo: la fase aspetta il giorno dopo
          if (disp < Math.min(resto[fase], libere)) attese[fase] += Math.min(resto[fase], libere) - disp;
          var h = Math.min(resto[fase], disp, libere);
          uso[d][rep] += h; libere -= h; resto[fase] -= h;
          blocchi.push({ g: d, fase: fase, h: h });
          if (resto[fase] <= 0) { fase++; while (fase < 5 && resto[fase] <= 0) fase++; }
        }
        if (fase >= 5) fine = d;
      }
      // motivo, se finisce dopo la consegna: il reparto che era pieno nei giorni in cui la vettura aspettava
      var motivo = null;
      if (fine == null || fine > v.consegna) {
        var piu = attese.indexOf(Math.max.apply(null, attese)), rep = REPARTI.filter(function (x) { return x.k === FASI[piu].rep; })[0];
        motivo = fine == null ? 'Non ci sono abbastanza ore nelle prossime due settimane.' : rep.nome + ' al completo: prima le vetture con la consegna più vicina.';
      }
      esito[v.targa] = { fine: fine, blocchi: blocchi, attese: attese, ritardo: fine == null || fine > v.consegna, margine: fine === v.consegna, motivo: motivo };
    });
    return { esito: esito, uso: uso, cap: cap };
  }
  // per ogni giorno di ingresso possibile: fine della vettura nuova e vetture che cambierebbero data
  function stime(vetture, assenze, nuova) {
    var base = piano(vetture, assenze).esito;
    return GIORNI.map(function (g) {
      var v = Object.assign({}, nuova, { ingresso: g.i });
      var p = piano(vetture.concat([v]), assenze);
      var cambiano = vetture.filter(function (x) { return p.esito[x.targa].fine !== base[x.targa].fine; }).map(function (x) {
        return { targa: x.targa, prima: base[x.targa].fine, dopo: p.esito[x.targa].fine, ritardo: p.esito[x.targa].ritardo && !base[x.targa].ritardo };
      });
      return { giorno: g.i, fine: p.esito[v.targa].fine, ritardo: p.esito[v.targa].ritardo, cambiano: cambiano, piano: p };
    });
  }
  radice.ZenSim = { FASI: FASI, REPARTI: REPARTI, GIORNI: GIORNI, piano: piano, stime: stime, capacita: capacita };
})(typeof window !== 'undefined' ? window : globalThis);
