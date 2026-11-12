'use strict';
/* Pianificazione Carrozzeria – accesso, scelta della carrozzeria, utenti.
   Collegamento con Supabase (sb) e con le funzioni sul server (chiamaFunzione), usati anche da planning.js. */
const { url: SB_URL, chiave: SB_CHIAVE } = window.CONFIG;
// i link di invito e di recupero password arrivano con #…&type=invite|recovery (letti prima che supabase-js li tolga)
const ARRIVO = new URLSearchParams(location.hash.slice(1));
const TIPO_LINK = ARRIVO.get('type'), ERRORE_LINK = ARRIVO.get('error_description');
if (window.top !== window.self) { document.documentElement.style.display = 'none'; try { window.top.location.href = location.href; } catch (e) { } }
const sb = supabase.createClient(SB_URL, SB_CHIAVE, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

/** Chiama una funzione sul server con il token dell'utente. Errori: Error con .codice e .status. */
async function chiamaFunzione(nome, corpo, signal) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { const e = new Error('Sessione scaduta: accedi di nuovo'); e.status = 401; throw e; }
  let r;
  try {
    r = await fetch(SB_URL + '/functions/v1/' + nome, {
      method: 'POST', signal, body: JSON.stringify(corpo),
      headers: { 'Content-Type': 'application/json', apikey: SB_CHIAVE, Authorization: 'Bearer ' + session.access_token }
    });
  } catch (err) { if (err && err.name === 'AbortError') throw err; const e = new Error('Connessione non riuscita'); e.codice = 'network'; throw e; }
  let d = null; try { d = await r.json(); } catch (err) { }
  if (!r.ok) { const e = new Error((d && d.errore) || 'Errore ' + r.status); e.status = r.status; e.codice = d && d.codice; throw e; }
  return d;
}

const Accesso = (() => {
  const RUOLI = { titolare: 'Titolare', accettazione: 'Accettazione', officina: 'Officina', amministrazione: 'Amministrazione', gestore: 'Gestore' };
  const SPIEGA = {
    titolare: 'tutto, compresi utenti, copie e ripristini',
    accettazione: 'vetture, operai, impostazioni, importi, copie',
    officina: 'consulta e segna le fasi fatte; non vede gli importi',
    amministrazione: 'consulta, gestisce importi e copie; non modifica le vetture',
    gestore: 'supervisiona dal Gestore e scrive i messaggi; nella carrozzeria vede tutto, importi compresi, senza modificare'
  };
  const PW_MIN = 10;
  const S = { utente: null, voci: [], menu: null, modifica: null, msg: '', ok: '', admin: false, nome: '', simula: '', gruppi: [], ordine: [], modGruppo: null, nomeGruppo: undefined, eliminate: false, cerca: '', menuSposta: false, bozza: null };
  // simulazione (2026-11-06): l'amministratore vede il planner come un altro ruolo, senza salvare; vale per la scheda del browser
  const SIMULA = 'zencar-simula';
  const simula = v => { try { if (v) sessionStorage.setItem(SIMULA, v); else sessionStorage.removeItem(SIMULA); } catch (e) { } location.reload(); };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const indirizzo = () => location.origin + location.pathname;
  const voce = id => S.voci.find(s => s.id === id);
  const ultima = () => { try { return localStorage.getItem('planning-sede-ultima') || ''; } catch (e) { return ''; } };
  // Gestore: parti apribili di ogni gruppo (fatturato della settimana, attività suggerita), chiuse di base e ricordate
  // anche dopo «Aggiorna» e alla visita successiva. aperti[parte][gruppo] = true
  const aperti = (() => {
    const a = { fatt: {}, sugg: {} };
    try { Object.assign(a, JSON.parse(localStorage.getItem('planning-gestore-aperti') || '{}') || {}); } catch (e) { }
    try { const vecchio = JSON.parse(localStorage.getItem('planning-gestore-fatturato') || 'null'); if (vecchio) Object.assign(a.fatt, vecchio); } catch (e) { }
    return a;
  })();
  const salvaAperti = () => { try { localStorage.setItem('planning-gestore-aperti', JSON.stringify(aperti)); localStorage.removeItem('planning-gestore-fatturato'); } catch (e) { } };
  function mostraAperti() {
    if (!box) return;
    for (const g of box.querySelectorAll('[data-gs-gruppo]')) for (const parte of Object.keys(aperti)) {
      const si = !!(aperti[parte] || {})[g.dataset.gsGruppo]; g.classList.toggle('apri-' + parte, si);
      g.querySelectorAll('[data-gs-apri="' + parte + '"]').forEach(b => b.setAttribute('aria-expanded', String(si)));
    }
  }
  let box = null, larghezzaGestore = 0, lettoGestore = 0, gestoreInCorso = false, richiestaGestore = 0;
  // ogni quanto si rileggono i dati del gestore aperto (le prove automatiche lo accorciano con __GESTORE_OGNI)
  const ogniGestore = () => window.__GESTORE_OGNI ?? 10 * 60 * 1000;

  function pagina() {
    if (!box) {
      box = document.createElement('div'); box.id = 'landing'; box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'Pianificazione Carrozzeria');
      document.body.appendChild(box);
      box.addEventListener('click', clic);
      // Gestore: le ore di una cella, passando sopra con il mouse o selezionandola (clic, tocco, tastiera)
      box.addEventListener('mouseover', ev => { const c = ev.target.closest('[data-gs-info]'); if (c) mostraInfo(c); });
      box.addEventListener('mouseout', ev => { const c = ev.target.closest('[data-gs-info]'); if (c && !c.contains(ev.relatedTarget) && document.activeElement !== c) nascondiInfo(); });
      box.addEventListener('focusin', ev => { const c = ev.target.closest('[data-gs-info]'); if (c) mostraInfo(c); else nascondiInfo(); });
      box.addEventListener('focusout', ev => { if (ev.target.closest('[data-gs-info]')) nascondiInfo(); });
      box.addEventListener('scroll', () => nascondiInfo(), true); box.addEventListener('submit', ev => { ev.preventDefault(); if (ev.target.dataset.modoForm) inviaAccesso(ev.target); else if (ev.target.dataset.gs) inviaGestore(ev.target); });
      box.addEventListener('keydown', tasti);
      box.addEventListener('input', ev => {
        const n = ev.target.matches && ev.target.matches('[data-num]') && ev.target;
        if (n) { if (/\D/.test(n.value)) n.value = n.value.replace(/\D/g, ''); const a = box.querySelector(`[data-anteprima="${n.dataset.num}"]`); if (a) a.textContent = n.value || a.dataset.iniziali; return; }
        if (ev.target.matches && ev.target.matches('[data-cerca]')) { S.cerca = ev.target.value; S.menu = null; mostraElenco('[data-cerca]'); } });
      // pagina delle carrozzerie: schede e gruppi si trascinano (2026-11-11)
      box.addEventListener('dragstart', trascinaInizio); box.addEventListener('dragover', trascinaSopra);
      box.addEventListener('drop', trascinaLascia); box.addEventListener('dragend', trascinaFine);
      // Gestore: dati riletti ogni 10 minuti mentre è aperto (e al ritorno su una scheda rimasta nascosta)
      const gestoreVecchio = () => box && box.querySelector('.gestore .gs-head') && !box.querySelector('.gs-form') && Date.now() - lettoGestore >= ogniGestore();
      setInterval(() => { if (document.visibilityState === 'visible' && gestoreVecchio()) apriGestore({}, true); }, 30 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && gestoreVecchio()) apriGestore({}, true); });
      // Gestore: se la finestra cambia molto di larghezza si richiede la pagina, con le settimane in fasce che entrano
      let attesa = 0; addEventListener('resize', () => { clearTimeout(attesa); attesa = setTimeout(() => { if (box && box.querySelector('.gestore .gs-gruppo') && !box.querySelector('.gs-form') && Math.abs(box.clientWidth - larghezzaGestore) > 60) apriGestore({}, true); }, 400); });
      box.addEventListener('change', ev => { const x = ev.target.closest('[data-gs-sett]'); if (x) { try { localStorage.setItem('planning-gestore-settimane', x.value); } catch (e) { } apriGestore(); } });
    }
    return box;
  }
  /** Nome della zona per il lettore di schermo, secondo quello che mostra. */
  // dopo ogni ridisegno della pagina (che ne sostituisce il contenuto) il menu dell'account torna al suo posto
  const vista = nome => { pagina().setAttribute('aria-label', nome); if (nome !== 'Scegli la carrozzeria') chiudiAvviso(); box.classList.toggle('elenco', nome === 'Scegli la carrozzeria'); if (nome !== 'Accesso') queueMicrotask(() => mostraConto()); return box; };

  /* Gestore: riquadro con le ore della cella (blu notte come i suggerimenti «i»); il testo lo prepara il server */
  let info = null, infoDi = null;
  function mostraInfo(c) {
    if (!info) { info = document.createElement('div'); info.id = 'gsInfo'; info.className = 'gs-info'; info.setAttribute('role', 'tooltip'); document.body.appendChild(info); }
    infoDi = c; info.textContent = c.dataset.gsInfo; info.hidden = false;
    const r = c.getBoundingClientRect(), w = info.offsetWidth, h = info.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const sopra = r.top - h - 8 >= 8;
    info.style.left = x + 'px'; info.style.top = (sopra ? r.top - h - 8 : r.bottom + 8) + 'px';
  }
  function nascondiInfo() { if (info) info.hidden = true; infoDi = null; }
  /** Frecce tra le celle della stessa mappa (un solo punto di sosta del tasto Tab per mappa). */
  function frecciaCella(ev) {
    const c = ev.target.closest('[data-gs-info]'); if (!c) return false;
    if (ev.key === 'Escape') { nascondiInfo(); return true; }
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); infoDi === c ? nascondiInfo() : mostraInfo(c); return true; }
    const d = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[ev.key]; if (!d) return false;
    ev.preventDefault();
    const m = c.closest('.gs-mappa'), r = +c.dataset.gsR + d[0], k = +c.dataset.gsK + d[1];
    const dopo = m.querySelector(`[data-gs-r="${r}"][data-gs-k="${k}"]`);
    if (dopo) { m.querySelectorAll('[data-gs-info][tabindex="0"]').forEach(x => { x.tabIndex = -1; }); dopo.tabIndex = 0; dopo.focus(); }
    return true;
  }

  function testoErrore(e) {
    const m = (e && (e.errore || e.message)) || String(e);
    if (/Invalid login credentials/i.test(m)) return 'Email o password non corretti.';
    if (/Email not confirmed/i.test(m)) return 'Email non ancora confermata: usa il link dell’invito.';
    if (/Password should be at least/i.test(m)) return 'La password deve avere almeno ' + PW_MIN + ' caratteri.';
    if (/should be different/i.test(m)) return 'La nuova password deve essere diversa da quella attuale.';
    if (/rate limit|too many/i.test(m)) return 'Troppi tentativi: riprova tra qualche minuto.';
    if (/amministratore/i.test(m)) return 'L’amministratore non può cambiare ruolo né essere rimosso.';
    if (/carrozzerie_nome_unico|duplicate key/i.test(m)) return 'C’è già una carrozzeria con questo nome.';
    if (/Failed to fetch|NetworkError|Load failed|Connessione/i.test(m)) return 'Connessione non riuscita: controlla la rete e riprova.';
    if (/JWT|session/i.test(m)) return 'La sessione è scaduta: accedi di nuovo.';
    return m;
  }

  /* ---------------------------------------------- accesso */
  /** email: quella già scritta, che resta nel campo dopo un errore (il cursore va sulla password). */
  function mostraAccesso(modo = 'accedi', msg = '', ok = '', email0 = '') {
    togliConto();
    const email = '<label>Email<input type="email" name="email" autocomplete="username" required maxlength="200"></label>';
    const M = {
      accedi: { sotto: 'Accedi con l’email e la password del tuo account.', pulsante: 'Accedi',
        campi: email + '<label>Password<input type="password" name="password" autocomplete="current-password" required></label>',
        fondo: '<button type="button" class="link" data-modo="recupera">Password dimenticata?</button>' },
      recupera: { sotto: 'Scrivi la tua email: riceverai un link per scegliere una nuova password.', pulsante: 'Invia il link',
        campi: email, fondo: '<button type="button" class="link" data-modo="accedi">Torna all’accesso</button>' },
      password: { sotto: 'Scegli la password per il tuo account: almeno ' + PW_MIN + ' caratteri.', pulsante: 'Salva la password',
        campi: '<label>Nuova password<input type="password" name="password" autocomplete="new-password" required minlength="' + PW_MIN + '"></label>' +
          '<label>Ripeti la password<input type="password" name="conferma" autocomplete="new-password" required minlength="' + PW_MIN + '"></label>', fondo: '' }
    }[modo];
    vista('Accesso').innerHTML = `<div class="lcard stretta"><div class="lhead"><h1>Pianificazione Carrozzeria</h1><p>${M.sotto}</p></div>
      ${msg ? `<p class="lerr" role="alert" id="accErr">${esc(msg)}</p>` : ''}${ok ? `<p class="lok" role="status">${esc(ok)}</p>` : ''}
      <form class="modulo" data-modo-form="${modo}" novalidate${msg ? ' aria-describedby="accErr"' : ''}>${M.campi}<button type="submit" class="btn pri">${M.pulsante}</button>${M.fondo ? `<div>${M.fondo}</div>` : ''}</form></div>`;
    const em = box.querySelector('input[name=email]'); if (em && email0) em.value = email0;
    const f = (em && email0 && box.querySelector('input[type=password]')) || box.querySelector('input'); if (f) f.focus();
  }

  async function inviaAccesso(form) {
    const modo = form.dataset.modoForm, v = Object.fromEntries(new FormData(form));
    const errore = m => mostraAccesso(modo, m, '', (v.email || '').trim());
    if (modo !== 'password' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v.email || '').trim())) return errore('Scrivi un’email valida.');
    if (modo === 'password') {
      if ((v.password || '').length < PW_MIN) return errore('La password deve avere almeno ' + PW_MIN + ' caratteri.');
      if (v.password !== v.conferma) return errore('Le due password non coincidono.');
    }
    form.querySelector('[type=submit]').disabled = true;
    try {
      if (modo === 'accedi') {
        const { error } = await sb.auth.signInWithPassword({ email: v.email.trim(), password: v.password });
        if (error) throw error;
        await avvia();
      } else if (modo === 'recupera') {
        const { error } = await sb.auth.resetPasswordForEmail(v.email.trim(), { redirectTo: indirizzo() });
        if (error) throw error;
        mostraAccesso('accedi', '', 'Se l’email è registrata riceverai un link per scegliere una nuova password.');
      } else {
        const { error } = await sb.auth.updateUser({ password: v.password });
        if (error) throw error;
        await avvia('Password salvata.');
      }
    } catch (e) { errore(testoErrore(e)); }
  }

  /* ---------------------------------------------- elenco delle carrozzerie */
  async function caricaElenco() {
    const [{ data, error }, adm, nome, gruppi, ordine] = await Promise.all([sb.from('membri').select('ruolo, carrozzerie(id, numero, nome, sigla, eliminata_il)').eq('user_id', S.utente.id), sb.rpc('sono_amministratore'), sb.rpc('mio_nome'),
      sb.from('gruppi_gestore').select('id, nome, carrozzerie').order('posizione').order('creato_il'), sb.from('ordine_carrozzerie').select('carrozzerie').maybeSingle()]);
    if (error) throw error;
    S.admin = adm.data === true; S.nome = nome.data || '';
    // disposizione della pagina (2026-11-11): se non si legge, la pagina resta nell'ordine dei numeri e senza gruppi
    S.gruppi = gruppi.error ? [] : (gruppi.data || []).map(g => ({ id: g.id, nome: g.nome, carrozzerie: g.carrozzerie || [] }));
    S.ordine = ordine.error || !ordine.data ? [] : ordine.data.carrozzerie || [];
    try { const r = sessionStorage.getItem(SIMULA) || ''; S.simula = S.admin && RUOLI[r] ? r : ''; } catch (e) { S.simula = ''; }
    // consumi del piano (2026-11-10): solo l'amministratore; se la lettura non riesce la pagina resta com'è
    S.consumi = null;
    if (S.admin) { const k = await sb.rpc('consumi_piano'); S.consumi = k.error ? null : k.data; }
    S.voci = data.filter(r => r.carrozzerie).map(r => Object.assign({}, r.carrozzerie, { ruolo: r.ruolo }))
      .sort((a, b) => (a.numero ?? 1e9) - (b.numero ?? 1e9) || a.nome.localeCompare(b.nome, 'it'));
  }
  const vive = () => S.voci.filter(s => !s.eliminata_il);
  const titolareDi = s => s.ruolo === 'titolare';
  // Gestore e nuove carrozzerie (2026-11-04): solo per chi segue più sedi. Una carrozzeria con una sola sede non ne ha bisogno.
  const piuSedi = () => S.admin || vive().filter(titolareDi).length >= 2;
  const vedeGestore = () => piuSedi() || vive().some(s => s.ruolo === 'gestore');
  function nomeErrore(nome, id) {
    if (!nome) return 'Scrivi un nome.';
    if (nome.length > 60) return 'Il nome può avere al massimo 60 caratteri.';
    if (vive().some(s => s.id !== id && s.nome.toLowerCase() === nome.toLowerCase())) return 'C’è già una carrozzeria con questo nome.';
    return '';
  }
  const GEAR = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  // icone della colonna laterale e dei gruppi (strumenti dal 2026-11-05, colonna dal 2026-11-11)
  const ICONA = {
    gestore: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    persone: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    cestino: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    maniglia: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>'
  };
  /** Iniziali nel quadratino della scheda (2026-11-12): dalla parte del nome che distingue, diverse per ogni scheda.
      «Carrozzeria 4» → 4; «Milano Nord» e «Milano Sud» (la città è in comune) → NO e SU; «Modena» e «Monza» → MO e MN. */
  const GENERICI = /^(auto)?carrozzeri[ae]$|^sede$|^officina$/i;
  function sigle(voci) {
    const parole = voci.map(s => String(s.nome).trim().split(/\s+/).filter(Boolean)), primi = new Map(), usate = new Set(), out = new Map();
    for (const p of parole) if (p.length > 1) primi.set(p[0].toLowerCase(), (primi.get(p[0].toLowerCase()) || 0) + 1);
    voci.forEach((s, i) => {
      let p = parole[i];
      if (p.length > 1 && GENERICI.test(p[0])) p = p.slice(1);
      if (p.length > 1 && primi.get(p[0].toLowerCase()) > 1) p = p.slice(1);
      const w = p.map(x => x.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean), a = w[0] || '?', b = w[1] || '';
      let prove = /^\d+$/.test(a) && !b ? [a.slice(0, 3)] : (b ? [a[0] + b[0], ...[...b.slice(1)].map(c => a[0] + c)] : []).concat([...a.slice(1)].map(c => a[0] + c));
      prove = (prove.length ? prove : [a]).map(x => x.toUpperCase());
      const k = prove.find(x => !usate.has(x)) || prove[0]; usate.add(k); out.set(s.id, k);
    });
    return out;
  }
  // ricerca (2026-11-12): maiuscole e accenti non contano
  const senzaAccenti = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const quante = n => n + (n === 1 ? ' carrozzeria' : ' carrozzerie');
  // logo ZenCar (assets/zencar-logo.svg, senza metadati e con i numeri arrotondati), in alto a destra nella pagina delle carrozzerie
  const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 407 110" aria-hidden="true" focusable="false"><g transform="scale(0.9167)"><rect x="10" y="10" width="46" height="46" rx="13" fill="#4C5BFF"/><rect x="64" y="10" width="46" height="46" rx="13" fill="#4C5BFF"/><rect x="10" y="64" width="46" height="46" rx="13" fill="#4C5BFF"/><circle cx="87" cy="87" r="21" fill="none" stroke="#0B0D12" stroke-width="8"/><circle cx="87" cy="87" r="5" fill="#0B0D12"/></g><path d="M136.3 84.8V75.4L165.9 34.7H137.5V25.2H179.2V34.6L149.3 75.3H180.2V84.8Z M203.6 85.8Q196.8 85.8 191.9 82.9Q186.9 80 184.2 74.7Q181.5 69.4 181.5 62.4Q181.5 55.3 184.2 50Q186.9 44.8 191.8 41.9Q196.7 39 203.3 39Q209.7 39 214.5 41.8Q219.3 44.7 221.9 50Q224.6 55.4 224.6 63V65.4H192.7Q193 71.3 195.9 74.3Q198.8 77.3 203.6 77.3Q210.9 77.3 213 71L224 71.7Q222.1 78.3 216.7 82Q211.3 85.8 203.6 85.8ZM192.7 58.2H213.5Q213 52.7 210.3 50.1Q207.6 47.4 203.3 47.4Q198.9 47.4 196.2 50.2Q193.4 53 192.7 58.2Z M229.6 84.8V40H239.3L239.6 47.6Q241.4 43 245 41Q248.6 39 253 39Q260.4 39 264.4 43.7Q268.3 48.4 268.3 56V84.8H257.6V59.5Q257.6 53.7 255.8 50.7Q254.1 47.7 249.8 47.7Q245.4 47.7 242.9 50.7Q240.3 53.7 240.3 59.5V84.8Z M301.2 86.2Q293.1 86.2 286.9 82.4Q280.7 78.7 277.1 71.8Q273.6 64.8 273.6 55.1Q273.6 45.5 277.1 38.5Q280.5 31.5 286.7 27.7Q292.9 23.8 301.3 23.8Q312.8 23.8 319.1 29.5Q325.4 35.2 327.3 45.3L315.9 45.9Q314.8 40 311.2 36.7Q307.5 33.3 301.3 33.3Q293.8 33.3 289.3 39.2Q284.9 45.1 284.9 55.1Q284.9 65.2 289.4 70.9Q293.9 76.7 301.2 76.7Q307.9 76.7 311.5 73Q315.2 69.4 316.2 63L327.6 63.6Q325.9 74.1 319.2 80.1Q312.5 86.2 301.2 86.2Z M345.5 85.8Q338.5 85.8 334.2 82.6Q329.9 79.4 329.9 73.6Q329.9 67.8 333.5 64.5Q337.1 61.2 344.5 59.8L359.4 56.8Q359.4 47.3 350.7 47.3Q346.9 47.3 344.6 49.1Q342.3 50.9 341.6 54.2L330.6 53.7Q332 46.7 337.2 42.8Q342.4 39 350.7 39Q360.3 39 365.2 43.8Q370.1 48.6 370.1 57.6V73.9Q370.1 75.7 370.8 76.3Q371.4 77 372.6 77H374.1V84.8Q372.6 85.2 370.1 85.2Q366.5 85.2 364 83.6Q361.5 82.1 360.8 78V77.9Q359.1 81.5 355 83.6Q351 85.8 345.5 85.8ZM347.7 78Q353.1 78 356.2 74.9Q359.4 71.8 359.4 66.7V64.2L347.8 66.5Q344.2 67.3 342.6 68.7Q341.1 70.2 341.1 72.6Q341.1 78 347.7 78Z M377 84.8V40H387.1L387.3 48.7Q388.7 44.2 391.3 42.1Q393.9 40 398.1 40H402.2V49.2H398Q392.9 49.2 390.3 51.5Q387.8 53.8 387.8 58.9V84.8Z" fill="#0B0D12"/></svg>';
  /** Colonna blu notte a sinistra (proposta C scelta dal titolare il 2026-11-11): chi è entrato, strumenti, Esci. */
  function laterale(gone) {
    const email = S.utente.email || '', chi = chiSono(), b = [];
    // il Gestore (proposta I, 2026-11-12): prima voce del menu, più grande e su una fascia chiara; le carrozzerie restano in primo piano
    const gestore = vedeGestore() ? `<button type="button" class="lges" data-gestore="1">${ICONA.gestore}<b>Gestore</b>
      <svg class="lges-f" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>` : '';
    if (sediMie().length) b.push(`<button type="button" class="lstr" data-persone="1">${ICONA.persone}<span class="lstr-t">Persone</span></button>`);
    if (gone.length) b.push(`<button type="button" class="lstr" data-eliminate="1" aria-expanded="${!!S.eliminate}">${ICONA.cestino}<span class="lstr-t">Carrozzerie eliminate (${gone.length})</span></button>`);
    b.push(`<button type="button" class="lstr" data-esci="1">${ESCI}<span class="lstr-t">Esci</span></button>`);
    return `<aside class="lside" aria-label="Account e strumenti">
      <div class="lside-tit"><h1>Pianificazione Carrozzeria</h1><p>Ogni carrozzeria ha operai, vetture e impostazioni separati.</p></div>
      <div class="lside-chi" title="${esc(email)}"><span class="conto-ini grande" aria-hidden="true">${esc((S.nome || email).charAt(0).toUpperCase())}</span>
        <span><b${S.nome ? '' : ' class="email"'}>${esc(S.nome || email)}</b><span>${esc(chi.ruolo)} · ${esc(chi.dove)}</span></span></div>
      <nav class="lside-nav" aria-label="Strumenti">${gestore}${b.join('')}</nav></aside>`;
  }

  /* ---------------------------------------------- disposizione (2026-11-11): l'utente ordina le carrozzerie trascinandole e le
     raccoglie in gruppi, gli stessi del Gestore. Si salva per utente (salva_disposizione); le altre persone non vedono cambi. */
  /** Gruppi e carrozzerie senza gruppo, nell'ordine scelto. Ogni carrozzeria compare una sola volta. */
  function disposizione() {
    const vivi = new Map(vive().map(s => [s.id, s])), usate = new Set();
    const gruppi = S.gruppi.map(g => ({ id: g.id, nome: g.nome, voci: g.carrozzerie.filter(id => vivi.has(id) && !usate.has(id) && usate.add(id)).map(id => vivi.get(id)) }));
    const pos = id => { const i = S.ordine.indexOf(id); return i < 0 ? 1e9 : i; };
    const sciolte = vive().filter(s => !usate.has(s.id)).map((s, i) => [s, i]).sort((a, b) => pos(a[0].id) - pos(b[0].id) || a[1] - b[1]).map(x => x[0]);
    return { gruppi, sciolte };
  }
  // le liste della pagina, dall'alto: un elenco di carrozzerie per gruppo e per ultimo quelle senza gruppo (id '')
  const liste = () => { const d = disposizione(); return [...d.gruppi.map(g => ({ id: g.id, ids: g.voci.map(s => s.id) })), { id: '', ids: d.sciolte.map(s => s.id) }]; };
  /* avviso in basso con «Annulla» dopo uno spostamento (2026-11-12): come l'avviso del planner, resta 10 secondi. Sta fuori
     dalla pagina, che si ridisegna a ogni cambio; il testo arriva al lettore di schermo da una zona di stato sempre presente. */
  const CHIUDI = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  let avviso = null, annuncio = null, tempoAvviso = 0, rimetti = null;
  function mostraAvviso(testo, annulla) {
    if (!avviso) {
      annuncio = document.createElement('p'); annuncio.id = 'lannuncio'; annuncio.setAttribute('role', 'status');
      avviso = document.createElement('div'); avviso.id = 'lavviso'; avviso.hidden = true;
      avviso.innerHTML = `<span class="la-t"></span><button type="button" class="la-a">Annulla</button><button type="button" class="la-x" aria-label="Chiudi avviso">${CHIUDI}</button>`;
      avviso.addEventListener('click', ev => { if (ev.target.closest('.la-a')) annullaSpostamento(); else if (ev.target.closest('.la-x')) chiudiAvviso(); });
      document.body.append(annuncio, avviso);
    }
    rimetti = annulla || null;
    avviso.querySelector('.la-t').textContent = testo;
    avviso.querySelector('.la-a').hidden = !annulla;
    avviso.hidden = false;
    annuncio.textContent = ''; requestAnimationFrame(() => { annuncio.textContent = testo + (annulla ? ' Per annullare: Ctrl+Z.' : ''); });
    clearTimeout(tempoAvviso); tempoAvviso = setTimeout(chiudiAvviso, 10000);
  }
  function chiudiAvviso() { clearTimeout(tempoAvviso); rimetti = null; if (avviso) avviso.hidden = true; }
  function annullaSpostamento() { const f = rimetti; chiudiAvviso(); if (f) f(); }
  /** Dopo uno spostamento la pagina cambia subito; il database si aggiorna in un solo passaggio. */
  function salvaDisposizione(L, fuoco, testo, annullabile = true) {
    const vivi = new Set(vive().map(s => s.id));
    const prima = { gruppi: S.gruppi.map(g => ({ id: g.id, ids: g.carrozzerie.filter(id => vivi.has(id)) })), sciolte: S.ordine.slice() };
    // le carrozzerie eliminate restano nel loro gruppo: se si ripristinano tornano al loro posto
    S.gruppi = L.filter(l => l.id).map(l => { const g = S.gruppi.find(x => x.id === l.id); return g && Object.assign(g, { carrozzerie: l.ids.concat(g.carrozzerie.filter(id => !vivi.has(id))) }); }).filter(Boolean);
    S.ordine = L.find(l => !l.id).ids;
    S.msg = ''; S.ok = '';
    mostraElenco(fuoco);
    mostraAvviso(testo, annullabile && (() => salvaDisposizione([...prima.gruppi, { id: '', ids: prima.sciolte }], fuoco, 'Spostamento annullato.', false)));
    sb.rpc('salva_disposizione', { gruppi: S.gruppi.map(g => ({ id: g.id, carrozzerie: g.carrozzerie })), sciolte: S.ordine })
      .then(({ error }) => { if (error) throw error; })
      .catch(async e => { console.error('[carrozzerie] disposizione', e); await aggiorna(); S.msg = 'Spostamento non salvato: riprova.'; mostraElenco(); });
  }
  const nomeDi = id => (voce(id) || {}).nome || '';
  const nomeLista = id => id ? 'nel gruppo ' + ((S.gruppi.find(g => g.id === id) || {}).nome || '') : 'tra le carrozzerie senza gruppo';
  /** Mette la carrozzeria nella lista del gruppo, prima o dopo la scheda di riferimento (senza riferimento: in fondo). */
  function spostaCarrozzeria(id, gruppo, accanto, dopo) {
    const L = liste(); for (const l of L) l.ids = l.ids.filter(x => x !== id);
    const l = L.find(x => x.id === gruppo); if (!l) return;
    const r = accanto ? l.ids.indexOf(accanto) : -1;
    l.ids.splice(r < 0 ? l.ids.length : r + (dopo ? 1 : 0), 0, id);
    salvaDisposizione(L, `[data-carr="${id}"] .lopen`, nomeDi(id) + ' spostata ' + nomeLista(gruppo) + '.');
  }
  // quante schede stanno in una riga della griglia di un gruppo (4, meno su schermi stretti)
  const colonne = zona => { const g = box.querySelector(`.lgrid[data-zona="${zona}"]`); return g ? getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length || 1 : 1; };
  /** Con la tastiera (Alt + frecce sul nome): ←→ un posto, ↑↓ una riga della griglia (2026-11-12). Dal primo posto o dalla
      prima riga si passa in fondo al gruppo di sopra; dall'ultimo posto o dall'ultima riga all'inizio di quello di sotto. */
  function spostaConTasti(id, passo, riga) {
    const L = liste(), li = L.findIndex(l => l.ids.includes(id)); if (li < 0) return;
    const l = L[li], i = l.ids.indexOf(id), n = riga ? colonne(l.id) : 1, tutte = l.ids.length, j = i + passo * n;
    l.ids.splice(i, 1);
    if (passo < 0 && j >= 0) l.ids.splice(j, 0, id);
    else if (passo > 0 && Math.floor(i / n) < Math.floor((tutte - 1) / n)) l.ids.splice(Math.min(j, tutte - 1), 0, id);
    else if (passo < 0 && li > 0) L[li - 1].ids.push(id);
    else if (passo > 0 && li < L.length - 1) L[li + 1].ids.unshift(id);
    else return;
    const dove = L.find(x => x.ids.includes(id));
    salvaDisposizione(L, `[data-carr="${id}"] .lopen`, nomeDi(id) + ': posto ' + (dove.ids.indexOf(id) + 1) + ' di ' + dove.ids.length + ' ' + nomeLista(dove.id) + '.');
  }
  /** Sposta un gruppo prima o dopo un altro; le carrozzerie senza gruppo restano sempre in fondo. */
  function spostaGruppo(id, accanto, dopo) {
    const L = liste(), g = L.find(l => l.id === id); if (!g) return;
    const altriGruppi = L.filter(l => l !== g), sciolte = altriGruppi.pop();
    let i = altriGruppi.findIndex(l => l.id === accanto); i = i < 0 ? altriGruppi.length : i + (dopo ? 1 : 0);
    altriGruppi.splice(i, 0, g);
    salvaDisposizione([...altriGruppi, sciolte], `[data-gmuovi="${id}"]`, 'Gruppo «' + ((S.gruppi.find(x => x.id === id) || {}).nome || '') + '» spostato: posto ' + (i + 1) + ' di ' + altriGruppi.length + '.');
  }

  // trascinamento con il mouse: presa = { tipo: 'c' (carrozzeria) | 'g' (gruppo), id }
  let presa = null;
  const SEGNI = ['drop-prima', 'drop-dopo', 'drop-dentro', 'drop-sopra', 'drop-sotto'];
  function segno(el, cls) {
    for (const x of box.querySelectorAll('.' + SEGNI.join(',.'))) if (x !== el) x.classList.remove(...SEGNI);
    if (el && !el.classList.contains(cls)) { el.classList.remove(...SEGNI); el.classList.add(cls); }
  }
  /** Dove cadrebbe ciò che si trascina: { el (da segnare), cls, gruppo, accanto }; el null = sopra se stesso, nessun effetto. */
  function bersaglio(ev) {
    const t = ev.target && ev.target.closest ? ev.target : ev.target && ev.target.parentElement; if (!presa || !t) return null;
    if (presa.tipo === 'c') {
      const c = t.closest('.lcardi[data-carr]');
      if (c && c.dataset.carr === presa.id) return { el: null };
      if (c) { const r = c.getBoundingClientRect(); return { el: c, cls: ev.clientX > r.left + r.width / 2 ? 'drop-dopo' : 'drop-prima', gruppo: c.closest('[data-zona]').dataset.zona, accanto: c.dataset.carr }; }
      const z = t.closest('.lgruppo[data-gruppo]');
      return z ? { el: z.querySelector('[data-zona]'), cls: 'drop-dentro', gruppo: z.dataset.gruppo, accanto: '' } : null;
    }
    const s = t.closest('.lgruppo[data-gruppo]:not(.sciolte)'); if (!s) return null;
    if (s.dataset.gruppo === presa.id) return { el: null };
    const r = s.getBoundingClientRect(); return { el: s, cls: ev.clientY > r.top + r.height / 2 ? 'drop-sotto' : 'drop-sopra', accanto: s.dataset.gruppo };
  }
  function trascinaInizio(ev) {
    const g = ev.target.closest && ev.target.closest('[data-gtrascina]'), c = !g && ev.target.closest && ev.target.closest('.lcardi[data-carr][draggable="true"]');
    if (!g && !c) return;
    presa = g ? { tipo: 'g', id: g.dataset.gtrascina } : { tipo: 'c', id: c.dataset.carr };
    ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', g ? 'gruppo' : nomeDi(presa.id)); } catch (e) { }
    const el = g ? g.closest('.lgruppo') : c; requestAnimationFrame(() => el.classList.add('presa'));
  }
  function trascinaSopra(ev) { const b = bersaglio(ev); if (!b) return presa && segno(null); ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; segno(b.el, b.cls); }
  function trascinaLascia(ev) {
    const b = bersaglio(ev), p = presa; if (!b) return;
    ev.preventDefault(); trascinaFine();
    if (!b.el) return;
    if (p.tipo === 'c') spostaCarrozzeria(p.id, b.gruppo, b.accanto, b.cls === 'drop-dopo');
    else spostaGruppo(p.id, b.accanto, b.cls === 'drop-sotto');
  }
  function trascinaFine() { presa = null; if (!box) return; segno(null); for (const x of box.querySelectorAll('.presa')) x.classList.remove('presa'); }

  /** Nuovo gruppo o nome cambiato: lo stesso salvataggio del Gestore (salva_gruppo_gestore). */
  async function salvaGruppo(id) {
    const inp = box.querySelector(`[data-gedit="${id}"]`), nome = (inp ? inp.value : '').trim().replace(/\s+/g, ' ');
    S.nomeGruppo = inp ? inp.value : '';
    const err = !nome ? 'Scrivi il nome del gruppo.' : nome.length > 60 ? 'Il nome può avere al massimo 60 caratteri.'
      : S.gruppi.some(g => g.id !== id && g.nome.toLowerCase() === nome.toLowerCase()) ? 'Hai già un gruppo con questo nome.' : '';
    if (err) { S.msg = err; S.ok = ''; return mostraElenco(`[data-gedit="${id}"]`); }
    const g = S.gruppi.find(x => x.id === id);
    try {
      const { error } = await sb.rpc('salva_gruppo_gestore', { g: g ? g.id : null, nome, scelte: g ? g.carrozzerie : [] }); if (error) throw error;
      await aggiorna('', g ? `[data-gmuovi="${g.id}"]` : '');
    } catch (e) { S.msg = testoErrore(e); S.ok = ''; mostraElenco(`[data-gedit="${id}"]`); }
  }
  /** Consumi del mese rispetto al piano gratuito di Supabase: numeri, percentuali e avviso arrivano già pronti dal database. */
  function consumiHtml() {
    const k = S.consumi; if (!k || !Array.isArray(k.voci)) return '';
    const voce = v => `<li${v.alto ? ' class="alto"' : ''}><span class="lc-nome">${esc(v.nome)}</span>
      <span class="lc-barra" aria-hidden="true"><i style="width:${Math.min(100, Number(v.perc) || 0)}%"></i></span>
      <span class="lc-val">${esc(v.uso)} di ${esc(v.limite)} · <b>${esc(String(v.perc))}%</b></span></li>`;
    const sedi = (k.sedi || []).length ? `<table class="lc-sedi"><caption>Chi consuma di più</caption><thead><tr><th scope="col">Carrozzeria</th><th scope="col">Chiamate</th><th scope="col">Traffico</th></tr></thead>
      <tbody>${k.sedi.map(x => `<tr><td>${esc(x.nome)}</td><td>${esc(x.richieste)}</td><td>${esc(x.traffico)}</td></tr>`).join('')}</tbody></table>` : '';
    return `<details class="lcons"${k.avviso ? ' open' : ''}><summary>Consumi del piano gratuito · ${esc(k.mese)}</summary>
      ${k.avviso ? `<p class="lerr" role="alert">${esc(k.avviso)}</p>` : ''}<ul>${k.voci.map(voce).join('')}</ul>${sedi}
      <p class="lnote">Conteggi del planner e del Gestore dal primo del mese. Il traffico è stimato per eccesso; i numeri esatti sono nella dashboard di Supabase, pagina Usage.</p></details>`;
  }
  const LENTE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>';
  const AVANTI = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  function landingHtml() {
    const last = ultima(), q = senzaAccenti(S.cerca.trim()), trova = s => !q || senzaAccenti(s.nome).includes(q), iniziali = sigle(vive());
    // nome e numero della filiale (2026-11-12): il numero, facoltativo, va nel quadratino al posto delle iniziali;
    // S.bozza tiene quanto scritto se il salvataggio dà errore
    const modifica = (id, nome, num) => { const b = S.bozza && S.bozza.id === id ? S.bozza : { nome, num: num || '' }, ini = id === 'nuova' ? '?' : iniziali.get(id) || '?';
      return `<div class="lcardi editing"><label class="lcampo"><span>Nome</span><input type="text" maxlength="60" value="${esc(b.nome)}" data-edit="${id}"></label>
      <label class="lcampo"><span>Numero filiale</span><span class="lnum"><span class="lsigla" aria-hidden="true" data-anteprima="${id}" data-iniziali="${esc(ini)}">${esc(b.num || ini)}</span>
        <input type="text" inputmode="numeric" maxlength="2" value="${esc(b.num)}" data-num="${id}" autocomplete="off"></span></label>
      <div class="lact"><button type="button" class="pri" data-save="${id}">Salva</button><button type="button" data-cancel="1">Annulla</button></div></div>`; };
    // durante la ricerca le schede non si spostano: si vedrebbe solo una parte di ogni gruppo
    const spostabili = vive().length > 1 && !q, sposta = spostabili && S.gruppi.length > 0;
    const card = s => {
      if (S.modifica === s.id) return modifica(s.id, s.nome, s.sigla);
      const tit = titolareDi(s), altrove = S.gruppi.filter(g => !g.carrozzerie.includes(s.id)), inGruppo = altrove.length < S.gruppi.length;
      // «Sposta nel gruppo» (2026-11-12): l'alternativa al trascinamento, anche per chi non è titolare
      const menu = S.menu !== s.id ? '' : S.menuSposta
        ? `<div class="lmenu" role="menu" aria-label="Sposta ${esc(s.nome)} in"><p class="lmtit" aria-hidden="true">Sposta in</p>${altrove.map(g => `<button type="button" role="menuitem" data-dove="${g.id}" data-chi="${s.id}">${esc(g.nome)}</button>`).join('')}
          ${inGruppo ? `<button type="button" role="menuitem" data-dove="-" data-chi="${s.id}">Senza gruppo</button>` : ''}</div>`
        : `<div class="lmenu" role="menu">${tit ? `<button type="button" role="menuitem" data-ren="${s.id}">Rinomina</button><button type="button" role="menuitem" data-utenti="${s.id}">Persone</button>` : ''}
          ${sposta ? `<button type="button" role="menuitem" class="lsub" data-sposta="${s.id}" aria-haspopup="menu">Sposta nel gruppo${AVANTI}</button>` : ''}${tit ? `<button type="button" role="menuitem" class="del" data-del="${s.id}">Elimina</button>` : ''}</div>`;
      return `<div class="lcardi${s.id === last ? ' last' : ''}" data-carr="${s.id}" draggable="${spostabili}"><button type="button" class="lopen" data-sede="${s.id}" title="${esc(s.nome)}"${spostabili ? ' aria-describedby="lcome"' : ''}>
        <span class="lsigla" aria-hidden="true"><span class="ls-t">${esc(s.sigla || iniziali.get(s.id) || '?')}</span>${spostabili ? ICONA.maniglia : ''}</span><span class="ltesto"><span class="lnome">${esc(s.nome)}</span><small>${esc(S.admin ? 'Amministratore' : RUOLI[s.ruolo])}${s.id === last ? ' · Ultima usata' : ''}</small></span></button>
        ${tit || sposta ? `<button type="button" class="lgear" data-menu="${s.id}" aria-haspopup="menu" aria-expanded="${S.menu === s.id}" aria-label="${tit ? 'Impostazioni di ' : 'Sposta '}${esc(s.nome)}" title="${tit ? 'Impostazioni' : 'Sposta nel gruppo'}">${GEAR}</button>${menu}` : ''}</div>`;
    };
    const nomeGruppo = (id, nome) => `<header class="lgh editing"><input type="text" maxlength="60" value="${esc(S.nomeGruppo ?? nome)}" data-gedit="${id}" aria-label="Nome del gruppo" placeholder="Per esempio: Zona nord">
      <button type="button" class="pri" data-gsalva="${id}">Salva</button><button type="button" data-gannulla="1">Annulla</button></header>`;
    const gruppo = (g, voci) => `<section class="lgruppo" data-gruppo="${g.id}" aria-label="Gruppo ${esc(g.nome)}">
      ${S.modGruppo === g.id ? nomeGruppo(g.id, g.nome) : q ? `<header class="lgh"><h3 title="${esc(g.nome)}">${esc(g.nome)}</h3><span class="lconta">${voci.length} di ${quante(g.voci.length)}</span></header>` : `<header class="lgh" draggable="true" data-gtrascina="${g.id}"><button type="button" class="lmaniglia" data-gmuovi="${g.id}" aria-label="Sposta il gruppo ${esc(g.nome)}" aria-describedby="lcome" title="Trascina per spostare il gruppo">${ICONA.maniglia}</button>
        <h3 title="${esc(g.nome)}">${esc(g.nome)}</h3><span class="lconta">${quante(voci.length)}</span>
        <span class="lgaz"><button type="button" data-grin="${g.id}">Rinomina</button><button type="button" class="del" data-gdel="${g.id}">Elimina il gruppo</button></span></header>`}
      <div class="lgrid" data-zona="${g.id}">${voci.map(card).join('') || '<p class="lvuoto">Trascina qui le carrozzerie del gruppo.</p>'}</div></section>`;
    const nuova = q ? '' : S.modifica === 'nuova' ? modifica('nuova', 'Carrozzeria ' + (vive().length + 1)) : (piuSedi() ? '<button type="button" class="ladd" data-add="1">+ Aggiungi carrozzeria</button>' : '');
    const gone = S.voci.filter(s => s.eliminata_il && titolareDi(s)), d = disposizione(), sciolteQui = d.sciolte.filter(trova);
    const sciolte = `<section class="lgruppo sciolte" data-gruppo="" aria-label="${d.gruppi.length ? 'Carrozzerie senza gruppo' : 'Carrozzerie'}">
      ${d.gruppi.length ? `<header class="lgh"><h3>Senza gruppo</h3><span class="lconta">${q ? sciolteQui.length + ' di ' : ''}${quante(d.sciolte.length)}</span></header>` : ''}
      <div class="lgrid" data-zona="">${sciolteQui.map(card).join('')}${d.gruppi.length && !d.sciolte.length ? '<p class="lvuoto">Trascina qui una carrozzeria per toglierla dal suo gruppo.</p>' : ''}${nuova}</div></section>`;
    const cerca = vive().length > 5 ? `<label class="lcerca">${LENTE}<input type="search" data-cerca="1" value="${esc(S.cerca)}" placeholder="Cerca carrozzeria" aria-label="Cerca carrozzeria" aria-describedby="lcercaAiuto" autocomplete="off" spellcheck="false"></label>
      <span class="lnasc" id="lcercaAiuto">Scrivi una parte del nome. Invio apre la prima carrozzeria trovata, Esc cancella la ricerca.</span>` : '';
    const trovate = vive().filter(trova).length;
    const nuovoGruppo = S.modGruppo === 'nuovo' ? `<section class="lgruppo" data-gruppo="nuovo" aria-label="Nuovo gruppo">${nomeGruppo('nuovo', '')}<p class="lvuoto">Dopo il salvataggio trascina qui le carrozzerie del gruppo.</p></section>` : '';
    return `<div class="lpag">${laterale(gone)}<main class="lmain"><div class="lmarchio" role="img" aria-label="ZenCar">${LOGO}</div>
      <div class="lbar"><h2 class="ltit">Le tue carrozzerie <span class="lconta">${q ? trovate + ' di ' : ''}${quante(vive().length)}</span></h2>
        <div class="lbar-az">${cerca}${spostabili ? '<button type="button" class="lnuovo" data-gnuovo="1">+ Nuovo gruppo</button>' : ''}</div></div>
      ${S.msg ? `<p class="lerr" role="alert">${esc(S.msg)}</p>` : ''}${S.ok ? `<p class="lok" role="status">${esc(S.ok)}</p>` : ''}${consumiHtml()}
      ${gone.length && S.eliminate ? `<section class="lgone" aria-labelledby="lgoneTit"><h3 id="lgoneTit" tabindex="-1">Carrozzerie eliminate (${gone.length})</h3><p class="lnote">Restano recuperabili finché non le elimini definitivamente.</p>
        ${gone.map(s => `<div class="lgrow"><span>${esc(s.nome)}</span><button type="button" data-restore="${s.id}">Ripristina</button><button type="button" class="del" data-wipe="${s.id}">Elimina definitivamente</button></div>`).join('')}</section>` : ''}
      ${q && !trovate ? `<p class="lnote lnessuna">Nessuna carrozzeria contiene «${esc(S.cerca.trim())}».</p>` : ''}
      ${vive().length || nuova ? d.gruppi.filter(g => !q || g.voci.some(trova)).map(g => gruppo(g, g.voci.filter(trova))).join('') + nuovoGruppo + (q && !sciolteQui.length ? '' : sciolte)
        : '<p class="lnote">Non hai ancora accesso a nessuna carrozzeria: chiedi al titolare di aggiungerti.</p>'}
      ${spostabili ? `<p class="lnote" id="lcome">Trascina una scheda per cambiarne l’ordine o per metterla in un gruppo${sposta ? ', oppure usa «Sposta nel gruppo» dall’ingranaggio' : ''}. Con la tastiera: Alt e le frecce sul nome. I gruppi sono gli stessi del Gestore e li vedi solo tu.</p>` : ''}
      </main></div>`;
  }
  function mostraElenco(focusSel) {
    nascondiInfo();
    const y = box ? box.scrollTop : 0;
    vista('Scegli la carrozzeria').innerHTML = landingHtml();
    box.scrollTop = y;
    const f = (focusSel && box.querySelector(focusSel)) || box.querySelector('[data-edit], [data-gedit]') || box.querySelector('.last .lopen') || box.querySelector('.lopen');
    if (f) { f.focus({ preventScroll: true }); if (focusSel) f.scrollIntoView({ block: 'nearest' }); if (f.matches('[data-cerca]')) f.setSelectionRange(f.value.length, f.value.length); else if (f.matches('input')) f.select(); }
  }
  async function aggiorna(ok = '', fuoco = '') {
    S.menu = null; S.menuSposta = false; S.modifica = null; S.bozza = null; S.modGruppo = null; S.nomeGruppo = undefined; S.ok = ok;
    chiudiAvviso(); // dopo una rilettura l'avviso non può più annullare
    try { await caricaElenco(); S.msg = ''; } catch (e) { S.msg = testoErrore(e); }
    mostraElenco(fuoco);
  }
  async function salvaNome(id) {
    const inp = box.querySelector(`[data-edit="${id}"]`), ni = box.querySelector(`[data-num="${id}"]`);
    const nome = (inp ? inp.value : '').trim().replace(/\s+/g, ' '), cifre = (ni ? ni.value : '').trim();
    S.bozza = { id, nome: inp ? inp.value : '', num: cifre };
    const num = /^\d{1,2}$/.test(cifre) ? cifre.padStart(2, '0') : null, altra = num && vive().find(s => s.id !== id && s.sigla === num);
    const errNum = cifre && !num ? 'Il numero filiale ha una o due cifre.' : altra ? 'Il numero ' + num + ' è già di ' + altra.nome + '.' : '';
    const err = nomeErrore(nome, id) || errNum;
    if (err) { S.msg = err; S.ok = ''; return mostraElenco(errNum && !nomeErrore(nome, id) ? `[data-num="${id}"]` : ''); }
    try {
      if (id === 'nuova') {
        const { data, error } = await sb.rpc('crea_carrozzeria', { nome }); if (error) throw error;
        if (num) { const r = await sb.from('carrozzerie').update({ sigla: num }).eq('id', data); if (r.error) throw r.error; }
      } else { const { error } = await sb.from('carrozzerie').update({ nome, sigla: num }).eq('id', id); if (error) throw error; }
      S.bozza = null; await aggiorna();
    } catch (e) { S.msg = testoErrore(e); S.ok = ''; mostraElenco(); }
  }

  async function clic(ev) {
    const m = ev.target.closest('[data-modo]'); if (m) return mostraAccesso(m.dataset.modo);
    if (!S.utente) return;
    const t = ev.target.closest('button');
    if (!t) { if (S.menu) { S.menu = null; mostraElenco(); } return; }
    if (t.dataset.gsChat) return apriChat(t.dataset.gsChat, t.dataset.gsTesto || '');
    if (t.dataset.gestore) return apriGestore();
    if (t.dataset.gsAggiorna) return apriGestore({}, true);
    if (t.dataset.gs) { if (t.dataset.gsConferma && !confirm(t.dataset.gsConferma)) return; return apriGestore({ azione: t.dataset.gs, id: t.dataset.gsId || '' }); }
    if (t.dataset.gsChiudi) return mostraElenco('[data-gestore]');
    if (t.dataset.gsApri) { const g = t.closest('[data-gs-gruppo]'), parte = t.dataset.gsApri; if (g && aperti[parte]) { aperti[parte][g.dataset.gsGruppo] = !g.classList.contains('apri-' + parte); salvaAperti(); mostraAperti(); } return; }
    S.msg = ''; S.ok = '';
    if (t.dataset.esci) { try { sessionStorage.removeItem(SIMULA); } catch (e) { } try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { } await sb.auth.signOut(); return location.reload(); }
    if (t.dataset.eliminate) { S.eliminate = !S.eliminate; return mostraElenco(S.eliminate ? '#lgoneTit' : '[data-eliminate]'); }
    if (t.dataset.gnuovo) { S.modGruppo = 'nuovo'; S.nomeGruppo = undefined; return mostraElenco('[data-gedit]'); }
    if (t.dataset.grin) { S.modGruppo = t.dataset.grin; S.nomeGruppo = undefined; return mostraElenco('[data-gedit]'); }
    if (t.dataset.gannulla) { const id = S.modGruppo; S.modGruppo = null; S.nomeGruppo = undefined; return mostraElenco(id && id !== 'nuovo' ? `[data-gmuovi="${id}"]` : '[data-gnuovo]'); }
    if (t.dataset.gsalva) return salvaGruppo(t.dataset.gsalva);
    if (t.dataset.gmuovi) return; // la maniglia si trascina, o si sposta con Alt e le frecce
    if (t.dataset.menu) { const id = t.dataset.menu; S.menu = S.menu === id ? null : id; S.menuSposta = false; return mostraElenco(S.menu ? `[data-carr="${id}"] .lmenu [role=menuitem]` : `[data-menu="${id}"]`); }
    if (t.dataset.sposta) { S.menuSposta = true; return mostraElenco(`[data-carr="${t.dataset.sposta}"] .lmenu [role=menuitem]`); }
    S.menu = null; S.menuSposta = false;
    if (t.dataset.dove) return spostaCarrozzeria(t.dataset.chi, t.dataset.dove === '-' ? '' : t.dataset.dove, '', false);
    if (t.dataset.sede) { S.cerca = ''; return apri(t.dataset.sede); }
    if (t.dataset.ren) { S.modifica = t.dataset.ren; S.bozza = null; return mostraElenco(); }
    if (t.dataset.add) { S.modifica = 'nuova'; S.bozza = null; return mostraElenco(); }
    if (t.dataset.cancel) { S.modifica = null; S.bozza = null; return mostraElenco(); }
    if (t.dataset.save) return salvaNome(t.dataset.save);
    if (t.dataset.utenti) return apriPersone(t.dataset.utenti); // dall'ingranaggio: la finestra Persone filtrata su quella sede
    if (t.dataset.persone) return apriPersone();
    try {
      if (t.dataset.gdel) {
        const g = S.gruppi.find(x => x.id === t.dataset.gdel);
        if (!g || !confirm('Eliminare il gruppo «' + g.nome + '»? Le carrozzerie restano: passano tra quelle senza gruppo. Il gruppo sparisce anche dal Gestore.')) return mostraElenco(`[data-gdel="${t.dataset.gdel}"]`);
        const { error } = await sb.from('gruppi_gestore').delete().eq('id', g.id); if (error) throw error;
        return aggiorna('', '[data-gnuovo]');
      }
      if (t.dataset.del) {
        const s = voce(t.dataset.del);
        if (!confirm('Eliminare ' + s.nome + '? Sparisce dall’elenco, ma i suoi dati restano recuperabili da «Carrozzerie eliminate».')) return mostraElenco();
        const { error } = await sb.rpc('elimina_carrozzeria', { c: s.id, definitiva: false }); if (error) throw error;
        return aggiorna();
      }
      if (t.dataset.restore) {
        const { error } = await sb.rpc('ripristina_carrozzeria', { c: t.dataset.restore }); if (error) throw error;
        return aggiorna();
      }
      if (t.dataset.wipe) {
        const s = voce(t.dataset.wipe);
        if (!confirm('Eliminare definitivamente ' + s.nome + '? Operai, vetture, impostazioni e copie di sicurezza verranno cancellati e non si potranno recuperare.')) return;
        t.disabled = true; t.textContent = 'Eliminazione…';
        const { error } = await sb.rpc('elimina_carrozzeria', { c: s.id, definitiva: true }); if (error) throw error;
        return aggiorna();
      }
    } catch (e) { S.msg = testoErrore(e); mostraElenco(); }
  }
  function tasti(ev) {
    if (frecciaCella(ev)) { ev.stopPropagation(); return; }
    if (ev.target.matches && ev.target.matches('[data-edit], [data-num]')) {
      if (ev.key === 'Enter') { ev.preventDefault(); salvaNome(ev.target.dataset.edit || ev.target.dataset.num); }
      if (ev.key === 'Escape') { ev.preventDefault(); S.modifica = null; S.bozza = null; mostraElenco(); }
    } else if (ev.target.matches && ev.target.matches('[data-gedit]')) {
      if (ev.key === 'Enter') { ev.preventDefault(); salvaGruppo(ev.target.dataset.gedit); }
      if (ev.key === 'Escape') { ev.preventDefault(); box.querySelector('[data-gannulla]').click(); }
    } else if (ev.target.matches && ev.target.matches('[data-cerca]')) {
      // ricerca (2026-11-12): Invio apre la prima carrozzeria trovata, Esc cancella
      if (ev.key === 'Enter') { ev.preventDefault(); const p = box.querySelector('.lopen[data-sede]'); if (S.cerca.trim() && p) p.click(); }
      if (ev.key === 'Escape' && S.cerca) { ev.preventDefault(); S.cerca = ''; mostraElenco('[data-cerca]'); }
    } else if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === 'z' && rimetti && !(ev.target.matches && ev.target.matches('input, textarea'))) {
      ev.preventDefault(); annullaSpostamento();
    } else if (ev.key === '/' && !(ev.target.matches && ev.target.matches('input, textarea')) && box.querySelector('[data-cerca]')) {
      ev.preventDefault(); box.querySelector('[data-cerca]').focus();
    } else if (/^Arrow(Up|Down)$/.test(ev.key) && !ev.altKey && ev.target.closest && ev.target.closest('.lmenu')) {
      // menu dell'ingranaggio: le frecce passano da una voce all'altra
      ev.preventDefault();
      const v = [...ev.target.closest('.lmenu').querySelectorAll('[role=menuitem]')], i = v.indexOf(ev.target);
      if (v.length) v[(i + (ev.key === 'ArrowDown' ? 1 : -1) + v.length) % v.length].focus();
    } else if (ev.altKey && /^Arrow(Left|Right|Up|Down)$/.test(ev.key) && ev.target.matches && ev.target.matches('.lopen[aria-describedby], [data-gmuovi]')) {
      // spostamenti con la tastiera: sul nome della carrozzeria ←→ un posto, ↑↓ una riga; sulla maniglia ↑↓ il gruppo
      ev.preventDefault();
      const avanti = ev.key === 'ArrowRight' || ev.key === 'ArrowDown', g = ev.target.dataset.gmuovi;
      if (g) {
        const gruppiPag = liste().filter(l => l.id), i = gruppiPag.findIndex(l => l.id === g), j = i + (avanti ? 1 : -1);
        if (i >= 0 && j >= 0 && j < gruppiPag.length) spostaGruppo(g, gruppiPag[j].id, avanti);
      } else spostaConTasti(ev.target.dataset.sede, avanti ? 1 : -1, /Up|Down/.test(ev.key));
    } else if (ev.key === 'Escape' && S.menu) { const id = S.menu; S.menu = null; S.menuSposta = false; mostraElenco(`[data-menu="${id}"]`); }
    ev.stopPropagation(); // le scorciatoie del planning restano spente
  }

  /* ---------------------------------------------- gestore: cruscotto di tutte le carrozzerie (pagina preparata dal server) */
  /** tranquillo: aggiornamento dei dati (tasto «Aggiorna» o ogni 10 minuti) senza spostare il fuoco né la posizione. */
  async function apriGestore(extra = {}, tranquillo = false) {
    if (tranquillo && gestoreInCorso) return;
    let n = 2; try { n = +localStorage.getItem('planning-gestore-settimane') || 2; } catch (e) { }
    gestoreInCorso = true; const n0 = ++richiestaGestore;
    const b = vista('Gestore'), prima = b.querySelector('.gestore'), agg = b.querySelector('[data-gs-aggiorna]');
    if (prima) {
      prima.setAttribute('aria-busy', 'true');
      // il tasto «Aggiorna» mostra che la lettura è in corso
      if (agg) { agg.disabled = true; agg.classList.add('in-corso'); agg.lastElementChild.textContent = 'Aggiorno…'; }
    } else b.innerHTML = '<div class="lcard gestore"><div class="lhead"><h1>Gestore</h1><p>Calcolo della saturazione di tutte le carrozzerie…</p></div></div>';
    try {
      // ora: solo l'orologio fisso delle prove (il server la accetta solo in locale, con CONSENTI_ORA_FINTA)
      // larghezza: solo per dividere le settimane in fasce che entrano nella pagina
      const r = await chiamaFunzione('gestore', Object.assign({ settimane: n, larghezza: (larghezzaGestore = b.clientWidth), ora: window.__ORA_FINTA || null }, extra));
      if (n0 !== richiestaGestore || !b.isConnected) return; // è partita una richiesta più recente: vale quella
      const su = b.scrollTop, fuocoAgg = agg && (document.activeElement === agg || document.activeElement === document.body);
      nascondiInfo();
      b.innerHTML = r.html; mostraAperti(); lettoGestore = Date.now(); ascoltaVersioni();
      if (tranquillo) { b.scrollTop = su; const x = b.querySelector('[data-gs-aggiorna]'); if (x && (fuocoAgg || document.activeElement === document.body)) x.focus({ preventScroll: true }); }
      else { const f = b.querySelector('.gs-form input') || b.querySelector('.gs-head h1'); if (f) f.focus({ preventScroll: true }); } // all'apertura il cursore va sul titolo, non su un campo (2026-11-05)
    } catch (e) {
      if (n0 !== richiestaGestore) return;
      // aggiornamento non riuscito: resta la pagina di prima, si riprova al prossimo giro
      if (tranquillo && prima && prima.isConnected) {
        prima.removeAttribute('aria-busy');
        if (agg) { agg.disabled = false; agg.classList.remove('in-corso'); agg.lastElementChild.textContent = 'Aggiorna'; }
        lettoGestore = Date.now() - ogniGestore() + 60 * 1000; }
      else { S.msg = testoErrore(e); S.ok = ''; mostraElenco(); }
    } finally { if (n0 === richiestaGestore) gestoreInCorso = false; }
  }

  /* ------------- gestore: messaggi con una carrozzeria. La conversazione la prepara il server; qui solo finestra e invio */
  // richiestaChat: solo la risposta più recente si mostra; invio: numero della richiesta di invio ancora in viaggio
  let chat = null, chatId = '', ascolto = null, contaAttesa = 0, ultimiContatori = 0, richiestaChat = 0, invio = 0;
  function finestraChat() {
    if (chat) return chat;
    chat = document.createElement('dialog'); chat.id = 'gsChat'; chat.className = 'gs-chatdlg'; chat.setAttribute('aria-labelledby', 'gsChatTitolo'); document.body.appendChild(chat);
    chat.addEventListener('click', ev => { if (ev.target.closest('[data-gs-chiudichat]')) chat.close(); });
    chat.addEventListener('close', () => { chatId = ''; if (box && box.querySelector('.gestore .gs-head')) aggiornaContatori(); });
    chat.addEventListener('submit', ev => {
      ev.preventDefault(); const f = ev.target;
      f.querySelectorAll('button').forEach(x => { x.disabled = true; });
      caricaChat({ azione: 'scrivi', id: f.dataset.gsId, campi: { testo: f.elements.testo.value } }, true);
    });
    return chat;
  }
  /** Mostra la conversazione dal server. tenere: conserva quello che si sta scrivendo (aggiornamento in tempo reale). */
  async function caricaChat(corpo, inviato = false, tenere = false) {
    const d = finestraChat(), n = ++richiestaChat, eraAperta = d.open;
    if (inviato) invio = n;
    try {
      const r = await chiamaFunzione('gestore', corpo);
      // risposta superata da una più recente, o finestra chiusa nel frattempo: non si mostra
      if (n !== richiestaChat || (eraAperta && !d.open)) return;
      // quello che si sta scrivendo si legge adesso, non alla partenza della richiesta
      const prima = d.querySelector('textarea'), scritto = prima ? prima.value : null;
      d.innerHTML = r.chat; chatId = corpo.id;
      if (!d.open) d.showModal();
      const ta = d.querySelector('textarea');
      if (ta && tenere && scritto != null) ta.value = scritto;
      if (ta && !tenere) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    } catch (e) {
      // l'errore si legge nella finestra; se non si è aperta, una finestra con il solo avviso
      if (tenere || n !== richiestaChat || (eraAperta && !d.open)) return;
      if (!d.open) {
        d.innerHTML = `<div class="gs-chat"><header><h2 id="gsChatTitolo">Messaggi</h2><button type="button" class="x" data-gs-chiudichat="1" aria-label="Chiudi">×</button></header>
          <p class="lerr" role="alert">${esc(testoErrore(e))}</p><div class="gs-azioni"><button type="button" class="gs-sec" data-gs-chiudichat="1">Chiudi</button></div></div>`;
        d.showModal(); return;
      }
      d.querySelectorAll('button').forEach(x => { x.disabled = false; });
      let p = d.querySelector('.lerr');
      if (!p) { p = document.createElement('p'); p.className = 'lerr'; p.setAttribute('role', 'alert'); const az = d.querySelector('form .gs-azioni'); if (az) az.before(p); else d.querySelector('.gs-chat').append(p); }
      p.textContent = testoErrore(e);
    } finally { if (invio === n) invio = 0; }
  }
  function apriChat(id, testo) { ascoltaVersioni(); return caricaChat({ azione: 'chat', id, testo: testo || undefined, ora: window.__ORA_FINTA || null }); }
  /** Risposte da leggere accanto a ogni carrozzeria, senza ricalcolare la pagina. */
  async function aggiornaContatori() {
    try {
      const r = await chiamaFunzione('gestore', { azione: 'contatori' });
      for (const b of box.querySelectorAll('[data-gs-msg]')) {
        const n = (r.nuovi || {})[b.dataset.gsMsg] || 0, x = b.querySelector('b');
        if (x) x.textContent = n ? String(n) : '';
        b.classList.toggle('nuovi', n > 0);
        b.setAttribute('aria-label', b.title + (n ? ', ' + n + ' da leggere' : ''));
      }
    } catch (e) { }
  }
  /** Tempo reale: quando cambia una carrozzeria (anche un messaggio nuovo o letto) si rilegge la conversazione aperta
      o si aggiornano i contatori. Il browser riceve solo il numero di versione, nessun dato. */
  function ascoltaVersioni() {
    if (ascolto) return;
    ascolto = sb.channel('gestore-versioni').on('postgres_changes', { event: '*', schema: 'public', table: 'versioni' }, p => {
      const c = p.new && p.new.carrozzeria_id;
      // durante un invio non serve: la risposta dell'invio porta già la conversazione aggiornata
      if (chat && chat.open && c === chatId) return invio ? undefined : caricaChat({ azione: 'chat', id: chatId, ora: window.__ORA_FINTA || null }, false, true);
      // contatori al massimo una volta al minuto (2026-11-10): con molte sedi i salvataggi arrivano di continuo,
      // e ognuno costerebbe una chiamata; le modifiche arrivate nell'attesa entrano tutte nella lettura successiva
      if (contaAttesa) return;
      contaAttesa = setTimeout(() => {
        contaAttesa = 0; ultimiContatori = Date.now();
        if (box && box.querySelector('.gestore .gs-head')) aggiornaContatori();
      }, Math.max(1500, ultimiContatori + (window.__CONTATORI_OGNI ?? 60 * 1000) - Date.now()));
    }).subscribe();
  }

  /** Modulo del gestore: tutti i campi così come sono (i ripetuti come elenco), li controlla il server. */
  function inviaGestore(form) {
    const campi = {};
    for (const [k, v] of new FormData(form)) campi[k] = k in campi ? [].concat(campi[k], v) : v;
    form.querySelectorAll('button').forEach(x => { x.disabled = true; });
    return apriGestore({ azione: form.dataset.gs, id: form.dataset.gsId || '', campi });
  }

  /** Apre il planning della carrozzeria scelta. */
  function apri(id, sola = '', vista = '') {
    const s = voce(id); if (!s || s.eliminata_il) return aggiorna();
    s.sola = sola; s.simula = S.simula; s.vista = vista;
    // il tabellone resta nell'indirizzo: lo schermo dell'officina, riacceso, torna da solo al tabellone
    try { history.replaceState(null, '', location.pathname + location.search + '#c=' + id + (vista ? '&' + vista + '=1' : '')); } catch (e) { }
    if (box) { box.remove(); box = null; }
    chiudiAvviso();
    if (ascolto) { sb.removeChannel(ascolto); ascolto = null; } // il gestore non ascolta più le versioni
    sedeAperta = s;
    // tabellone dell'officina (2026-11-11): tutto lo schermo, senza menu dell'account
    if (vista) { document.body.classList.add('vista-' + vista); togliConto(); } else mostraConto();
    bootSede(s);
  }

  /* ---------------------------------------------- persone (2026-11-05, scelta del titolare: un solo posto, come i pannelli di
     amministrazione di Microsoft 365 e Google Workspace). Elenco delle persone con ricerca e filtro per sede, scheda della
     persona scelta con una spunta e il ruolo per ogni sede, modifiche in bozza applicate con «Salva». Si apre dalla pagina
     delle carrozzerie (tutte le sedi) e dall'ingranaggio di una carrozzeria (filtrata su quella sede); sostituisce la
     finestra «Utenti» e «Persone e sedi». Funzioni: utenti_carrozzeria, membri, funzione utenti; i permessi li controlla il
     database (solo le sedi di cui si è titolari). */
  // errore di un modulo accanto al campo, senza ridisegnare: quanto scritto resta e il cursore va sul campo da correggere
  function erroreCampo(form, campo, testo) {
    const vecchio = form.querySelector('.m-err'); if (vecchio) vecchio.remove();
    form.querySelectorAll('[aria-invalid]').forEach(x => { x.removeAttribute('aria-invalid'); x.removeAttribute('aria-describedby'); });
    if (!campo || !testo) return;
    const id = 'err' + Math.random().toString(36).slice(2, 8);
    campo.insertAdjacentHTML('afterend', `<p class="lerr m-err" id="${id}" role="alert">${esc(testo)}</p>`);
    const f = campo.matches('input, select') ? campo : campo.querySelector('input, select');
    if (f) { f.setAttribute('aria-invalid', 'true'); f.setAttribute('aria-describedby', id); f.focus(); }
  }
  // una sola domanda, che dice chiaramente cosa fa «OK»
  const domandaScarta = (n, chi) => (n === 1 ? 'Hai 1 modifica non salvata' : 'Hai ' + n + ' modifiche non salvate') + (chi ? ' per ' + chi : '') + '.\nOK = scartale, Annulla = continua a modificare.';
  let dlgP = null;
  const P = { dati: null, scelta: null, cerca: '', filtro: '', bozza: null, email: '' };
  const pareEmail = t => /^[^s@]+@[^s@]+.[^s@]+$/.test(t);
  const sediMie = () => vive().filter(titolareDi);
  function finestraPersone() {
    if (!dlgP) {
      dlgP = document.createElement('dialog'); dlgP.id = 'dlgPersone'; dlgP.setAttribute('aria-label', 'Persone');
      document.body.appendChild(dlgP);
      dlgP.addEventListener('click', ev => {
        if (ev.target.closest('[data-x]')) { if (lasciaBozza()) dlgP.close(); return; } // niente chiusura con un clic sullo sfondo
        // il cursore resta sempre al posto giusto: sulla persona scelta, sul campo email, sulla prima spunta
        const v = ev.target.closest('[data-psel]'); if (v) { if (v.dataset.psel !== P.scelta && lasciaBozza()) { P.scelta = v.dataset.psel; P.bozza = null; P.nome = null; schedaPersone('', '', '.p-voce.on'); } return; }
        // dalla ricerca senza risultati (2026-11-06): l'email cercata passa nel modulo, il cursore va sul ruolo
        const nu = ev.target.closest('[data-pnuova]');
        if (nu) { if (lasciaBozza()) { P.scelta = 'nuova'; P.bozza = null; P.email = nu.dataset.pemail || ''; schedaPersone('', '', P.email ? '.p-form [name=ruolo]' : '.p-form [name=email]'); } return; }
        if (ev.target.closest('[data-pvedi]')) { if (lasciaBozza()) { P.filtro = ''; P.bozza = null; schedaPersone('', '', '[data-pcerca]'); } return; }
        if (ev.target.closest('[data-ptutte]')) { const b = bozza(); if (b) { for (const c in b) b[c] = ''; schedaPersone('', '', '[data-psalva]'); } return; }
        if (ev.target.closest('[data-pannulla]')) { P.bozza = null; P.nome = null; return schedaPersone('', '', '[data-psede]'); }
        if (ev.target.closest('[data-psalva]')) return salvaBozza();
      });
      dlgP.addEventListener('change', ev => {
        const c = ev.target.closest('[data-psede]'); if (c) return sedeSiNo(c);
        const r = ev.target.closest('[data-pruolo]'); if (r) return ruoloInSede(r);
        const f = ev.target.closest('[data-pfiltro]');
        if (f) { if (!lasciaBozza()) { f.value = P.filtro; return; } P.filtro = f.value; P.bozza = null; if (!visibile(personaScelta())) P.scelta = primaVisibile(); return schedaPersone('', '', '[data-pfiltro]'); }
        if (ev.target.matches('.p-form [name=ruolo]')) { const s = ev.target.form.querySelector('[data-spiega]'); if (s) s.innerHTML = `<strong>${RUOLI[ev.target.value]}</strong>: ${esc(SPIEGA[ev.target.value])}`; }
      });
      dlgP.addEventListener('input', ev => {
        if (ev.target.matches('[data-pcerca]')) { P.cerca = ev.target.value; filtraElenco(); }
        if (ev.target.matches('[data-pnome]')) { P.nome = ev.target.value; contaBozza(); }
      });
      dlgP.addEventListener('submit', ev => { ev.preventDefault(); aggiungiPersona(ev.target); });
      dlgP.addEventListener('keydown', ev => ev.stopPropagation());
      dlgP.addEventListener('cancel', ev => { if (!lasciaBozza()) ev.preventDefault(); }); // Esc con modifiche non salvate
    }
    return dlgP;
  }
  // sede: '' = tutte; dall'ingranaggio di una carrozzeria la finestra parte filtrata su quella
  async function apriPersone(sede = '') {
    const d = finestraPersone();
    P.dati = null; P.scelta = null; P.cerca = ''; P.bozza = null; P.email = ''; P.filtro = sede || '';
    d.innerHTML = `<div class="dh"><h3>Persone</h3><button class="x" type="button" data-x="1" aria-label="Chiudi">×</button></div><div class="db"><p class="lnote">Caricamento…</p></div>`;
    if (!d.open) d.showModal();
    await ricaricaPersone();
  }
  async function leggiPersone() {
    const sedi = sediMie(), persone = new Map();
    const elenchi = await Promise.all(sedi.map(s => sb.rpc('utenti_carrozzeria', { c: s.id })));
    elenchi.forEach((r, i) => {
      if (r.error) throw r.error;
      for (const u of r.data) {
        const p = persone.get(u.user_id) || { id: u.user_id, email: u.email, nome: u.nome || '', attivo: u.attivo, admin: u.amministratore, ruoli: {} };
        p.ruoli[sedi[i].id] = u.ruolo; p.attivo = p.attivo || u.attivo; persone.set(u.user_id, p);
      }
    });
    // per email; l'amministratore della piattaforma in fondo (non si modifica)
    return { sedi, persone: [...persone.values()].sort((a, b) => (a.admin - b.admin) || a.email.localeCompare(b.email, 'it')) };
  }
  // con il filtro per sede si vedono solo le persone di quella sede
  const visibile = p => !!p && (!P.filtro || !!p.ruoli[P.filtro]);
  const primaVisibile = () => { const v = P.dati.persone.filter(visibile); return (v.find(p => !p.admin) || v[0] || {}).id || 'nuova'; };
  async function ricaricaPersone(msg = '', ok = '', sceltaEmail = '') {
    try { P.dati = await leggiPersone(); } catch (e) { msg = testoErrore(e); }
    if (P.dati && P.filtro && !P.dati.sedi.some(s => s.id === P.filtro)) P.filtro = '';
    if (P.dati && sceltaEmail) { const p = P.dati.persone.find(x => x.email.toLowerCase() === sceltaEmail.toLowerCase()); if (p) { P.scelta = p.id; if (!visibile(p)) P.filtro = ''; } }
    if (P.dati && P.scelta !== 'nuova' && !visibile(personaScelta())) P.scelta = primaVisibile();
    schedaPersone(msg, ok, P.scelta === 'nuova' ? '.p-form [name=email]' : '.p-voce.on');
  }
  // riassunto della persona nell'elenco: ruolo e sedi (con il filtro: il ruolo in quella sede)
  function riassunto(p, sedi) {
    if (p.admin) return 'Amministratore della piattaforma';
    const dove = sedi.filter(s => p.ruoli[s.id]), invito = p.attivo ? '' : ' · invito in attesa';
    if (P.filtro) { const altre = dove.length - 1; return RUOLI[p.ruoli[P.filtro]] + (altre > 0 ? ' · anche in ' + (altre === 1 ? 'un’altra sede' : altre + ' altre sedi') : '') + invito; }
    const ruoli = [...new Set(dove.map(s => p.ruoli[s.id]))].map(r => RUOLI[r]).join(', ');
    const luoghi = sedi.length === 1 ? '' : dove.length === sedi.length && sedi.length > 2 ? ' · tutte le sedi' : ' · ' + dove.map(s => s.nome).join(', ');
    return (ruoli ? ruoli + luoghi : 'nessuna sede') + invito;
  }
  function filtraElenco() {
    const q = P.cerca.trim().toLowerCase(); let n = 0;
    dlgP.querySelectorAll('.p-voce').forEach(v => { v.hidden = !!q && !v.textContent.toLowerCase().includes(q); if (!v.hidden) n++; });
    const vuoto = dlgP.querySelector('.p-vuoto'); if (!vuoto) return;
    vuoto.hidden = n > 0; if (n) { vuoto.textContent = ''; return; }
    const t = P.cerca.trim();
    if (!q) { vuoto.textContent = 'Nessuna persona in questa sede.'; return; }
    // trovata solo fuori dal filtro: meglio mostrarla che aggiungerla di nuovo
    const altrove = P.filtro && P.dati.persone.some(p => !visibile(p) && p.email.toLowerCase().includes(q));
    vuoto.innerHTML = altrove ? `Nessuna persona trovata in questa sede per «${esc(t)}», ma c’è in altre sedi.<button type="button" class="btn sm" data-pvedi="1">Mostra tutte le sedi</button>`
      : `Nessuna persona trovata per «${esc(t)}».${pareEmail(t) ? `<button type="button" class="btn sm pri" data-pnuova="1" data-pemail="${esc(t)}">+ Aggiungi ${esc(t)}</button>` : '<button type="button" class="btn sm" data-pnuova="1">+ Aggiungi una persona</button>'}`;
  }
  // ruoli della persona scelta come appaiono nella scheda: la bozza, se c'è, altrimenti quelli salvati
  function bozza() {
    const p = personaScelta(); if (!p || p.admin) return null;
    if (!P.bozza) { P.bozza = {}; for (const s of P.dati.sedi) P.bozza[s.id] = p.ruoli[s.id] || ''; }
    return P.bozza;
  }
  const modifiche = () => { const p = personaScelta(); return !p || !P.bozza ? [] : P.dati.sedi.filter(s => (P.bozza[s.id] || '') !== (p.ruoli[s.id] || '')); };
  // nome in bozza (2026-11-06): undefined = non cambiato
  const nomeNuovo = () => { const p = personaScelta(); if (!p || P.nome == null) return undefined; const t = P.nome.trim().replace(/\s+/g, ' '); return t === (p.nome || '') ? undefined : t; };
  const daSalvare = () => modifiche().length + (nomeNuovo() === undefined ? 0 : 1);
  const chiE = p => p.nome ? p.nome + ' (' + p.email + ')' : p.email;
  // modifiche non salvate: una sola domanda, che dice chiaramente cosa succede con «OK»
  function lasciaBozza() {
    const n = daSalvare(); if (!n) return true;
    if (!confirm(domandaScarta(n, (personaScelta() || {}).email))) return false;
    P.bozza = null; P.nome = null; return true;
  }
  const ruoliTutti = () => `<details class="u-ruoli"><summary>Cosa può fare ogni ruolo</summary><dl>${Object.entries(SPIEGA).map(([k, t]) => `<dt>${RUOLI[k]}</dt><dd>${esc(t)}</dd>`).join('')}</dl></details>`;
  function schedaPersone(msg = '', ok = '', fuoco = '') {
    const d = P.dati, ruoliOpz = r => Object.entries(RUOLI).map(([k, n]) => `<option value="${k}"${k === r ? ' selected' : ''}>${n}</option>`).join('');
    if (!d) { dlgP.querySelector('.db').innerHTML = `<p class="lerr" role="alert">${esc(msg || 'Elenco non disponibile.')}</p>`; return; }
    const una = d.sedi.length === 1, nomeFiltro = P.filtro ? (d.sedi.find(s => s.id === P.filtro) || {}).nome : '';
    // la sede del filtro (o l'unica) in cima alla scheda
    const sediOrd = P.filtro ? [...d.sedi.filter(s => s.id === P.filtro), ...d.sedi.filter(s => s.id !== P.filtro)] : d.sedi;
    const elenco = d.persone.filter(visibile).map(p => `<button type="button" class="p-voce${p.id === P.scelta ? ' on' : ''}${p.admin ? ' admin' : ''}" data-psel="${p.id}"${p.id === P.scelta ? ' aria-current="true"' : ''}>
        <span class="p-nome">${esc(p.nome || p.email)}${p.id === S.utente.id ? ' <span class="u-tu">tu</span>' : ''}</span>${p.nome ? `<span class="p-mail2">${esc(p.email)}</span>` : ''}<span class="p-ria">${esc(riassunto(p, d.sedi))}</span></button>`).join('');
    let destra;
    if (P.scelta === 'nuova') {
      // ordine: chi, con quale ruolo, in quali sedi, poi «Aggiungi»; con il filtro (o una sola sede) la sede è già spuntata
      const spuntata = s => una || s.id === P.filtro;
      destra = `<form class="p-form" novalidate aria-labelledby="pNuova"><h4 id="pNuova">Aggiungi una persona</h4>
        <label class="p-nomecampo"><span>Nome e cognome <span class="p-fac">(facoltativo)</span></span><input type="text" name="nome" maxlength="80" autocomplete="off" placeholder="Mario Rossi"></label>
        <div class="p-campi2"><label>Email<input type="email" name="email" maxlength="200" required autocomplete="off" placeholder="nome@esempio.it" value="${esc(P.email)}"></label>
        <label>Ruolo<select name="ruolo">${ruoliOpz('accettazione')}</select></label></div>
        <p class="u-spiega" data-spiega aria-live="polite"><strong>${RUOLI.accettazione}</strong>: ${esc(SPIEGA.accettazione)}</p>
        ${una ? `<input type="hidden" name="sede" value="${d.sedi[0].id}">` : `<fieldset class="p-sedi"><legend>Sedi in cui lavora</legend>${sediOrd.map(s => `<label><input type="checkbox" name="sede" value="${s.id}"${spuntata(s) ? ' checked' : ''}> ${esc(s.nome)}</label>`).join('')}</fieldset>`}
        <div class="p-invia"><button type="submit" class="btn pri">Aggiungi</button></div>
        <p class="lnote">Se l’email non ha ancora un account, la persona riceve un invito da planner@zencar.it per scegliere la password.${una ? '' : '<br>Il ruolo vale in tutte le sedi spuntate; dopo si può cambiare sede per sede.'}</p>
        ${ruoliTutti()}</form>`;
    } else {
      const p = d.persone.find(x => x.id === P.scelta), b = bozza() || p.ruoli, cambiate = new Set(modifiche().map(s => s.id)), nn = nomeNuovo(), tot = cambiate.size + (nn === undefined ? 0 : 1);
      const usati = [...new Set(d.sedi.map(s => b[s.id]).filter(Boolean))];
      const base = usati[0] || 'accettazione';
      // la bozza lascia la persona senza nessuna sede: lo si dice chiaramente e «Salva» diventa «Togli l'accesso»
      const senzaSedi = !p.admin && !usati.length && d.sedi.some(s => p.ruoli[s.id]);
      const stato = p.attivo ? '<span class="u-stato attivo">Attivo</span>' : '<span class="u-stato attesa">Invito in attesa</span>';
      destra = `<div class="p-testa"><span class="p-ini" aria-hidden="true">${esc(p.email.charAt(0).toUpperCase())}</span><div><h4 class="p-mail">${esc(p.nome || p.email)}</h4>${p.nome ? `<span class="p-mail2">${esc(p.email)}</span>` : ''}${stato}${p.id === S.utente.id ? ' <span class="u-tu">tu</span>' : ''}</div></div>
        ${p.admin ? '<p class="p-nota">Amministratore della piattaforma: titolare di tutte le carrozzerie, non modificabile.</p>' : `
        <label class="p-nomecampo">Nome e cognome<input type="text" data-pnome="1" maxlength="80" autocomplete="off" placeholder="Mario Rossi" value="${esc(P.nome == null ? p.nome || '' : P.nome)}">${nn === undefined ? '' : '<span class="p-dasalvare">nome da salvare</span>'}</label>
        <section class="p-sez" aria-labelledby="pSedi"><h4 id="pSedi">${una ? 'Accesso' : 'Sedi in cui lavora'}</h4><div class="p-righe">
        ${sediOrd.map(s => { const r = b[s.id], o = p.ruoli[s.id], ca = cambiate.has(s.id);
          // cosa cambia, detto per esteso: «Gestore → Titolare», «da aggiungere», «da togliere»
          const cosa = !ca ? '' : !r ? 'da togliere' : !o ? 'da aggiungere' : RUOLI[o] + ' → ' + RUOLI[r];
          return `<div class="p-riga${r ? ' dentro' : ''}${ca ? ' cambiata' : ''}"><label><input type="checkbox" data-psede="${s.id}"${r ? ' checked' : ''}> ${esc(s.nome)}${cosa ? `<span class="p-dasalvare">${esc(cosa)}</span>` : ''}</label>
          <select data-pruolo="${s.id}" data-base="${o || base}" aria-label="Ruolo in ${esc(s.nome)}"${r ? '' : ' disabled'}>${r ? ruoliOpz(r) : '<option value="" selected>—</option>' + ruoliOpz('')}</select></div>`; }).join('')}</div></section>
        ${usati.length && !una ? '<button type="button" class="p-tutte" data-ptutte="1">Togli da tutte le sedi</button>' : ''}
        ${senzaSedi ? `<p class="p-avviso" role="note"><strong>${esc(p.email)} non potrà più entrare${una ? '' : ' in nessuna sede'}</strong> e sparirà da questo elenco. Per riaggiungerlo: «+ Aggiungi».</p>` : ''}
        ${usati.length ? `<div class="p-spiega">${usati.map(r => `<p><strong>${RUOLI[r]}</strong>: ${esc(SPIEGA[r])}</p>`).join('')}</div>` : ''}
        ${ruoliTutti()}
        <div class="p-piede"><p class="lnote">${una ? 'Scegli il ruolo o togli la spunta per togliere l’accesso, poi premi «Salva».' : 'Spunta le sedi e scegli il ruolo in ciascuna, poi premi «Salva».'}</p>
        <div class="p-azioni"><span class="p-conta" aria-live="polite">${tot ? (tot === 1 ? '1 modifica da salvare' : tot + ' modifiche da salvare') : ''}</span>
        <button type="button" class="btn" data-pannulla="1"${tot ? '' : ' disabled'}>Annulla</button><button type="button" class="btn ${senzaSedi ? 'p-togli' : 'pri'}" data-psalva="1"${tot ? '' : ' disabled'}>${senzaSedi ? 'Togli l’accesso' : 'Salva'}</button></div></div>`}`;
    }
    const filtro = una ? '' : `<label class="p-filtro"><span>Sede</span><select data-pfiltro="1"><option value="">Tutte le sedi</option>${d.sedi.map(s => `<option value="${s.id}"${s.id === P.filtro ? ' selected' : ''}>${esc(s.nome)}</option>`).join('')}</select></label>`;
    dlgP.querySelector('.dh h3').textContent = una ? 'Persone – ' + d.sedi[0].nome : nomeFiltro ? 'Persone – ' + nomeFiltro : 'Persone';
    dlgP.querySelector('.db').innerHTML = `${msg ? `<p class="lerr" role="alert">${esc(msg)}</p>` : ''}${ok ? `<p class="lok" role="status">${esc(ok)}</p>` : ''}
      <div class="p-due"><div class="p-elenco"><div class="p-cerca"><label class="p-q"><span class="p-nasc">Cerca</span><svg class="p-lente" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="6.8" cy="6.8" r="4.8"/><path d="m10.4 10.4 4 4"/></svg><input type="search" data-pcerca="1" placeholder="Nome o email…" value="${esc(P.cerca)}" autocomplete="off"></label>
        <button type="button" class="btn sm pri" data-pnuova="1">+ Aggiungi</button>${filtro}</div><div class="p-lista">${elenco}<p class="p-vuoto" hidden></p></div></div>
      <div class="p-scheda">${destra}</div></div>`;
    filtraElenco();
    const f = fuoco && dlgP.querySelector(fuoco); if (f) f.focus();
  }
  const personaScelta = () => P.dati && P.dati.persone.find(x => x.id === P.scelta);
  // conteggio e pulsanti aggiornati mentre si scrive il nome
  function contaBozza() {
    const t = daSalvare(), c = dlgP.querySelector('.p-conta'); if (c) c.textContent = t ? (t === 1 ? '1 modifica da salvare' : t + ' modifiche da salvare') : '';
    dlgP.querySelectorAll('[data-pannulla], [data-psalva]').forEach(x => { x.disabled = !t; });
  }
  function sedeSiNo(chk) {
    const b = bozza(); if (!b) return;
    const c = chk.dataset.psede, sel = dlgP.querySelector(`[data-pruolo="${c}"]`);
    b[c] = chk.checked ? (sel.value || sel.dataset.base) : '';
    schedaPersone('', '', `[data-psede="${c}"]`);
  }
  function ruoloInSede(sel) {
    const b = bozza(); if (!b) return;
    b[sel.dataset.pruolo] = sel.value;
    schedaPersone('', '', `[data-pruolo="${sel.dataset.pruolo}"]`);
  }
  async function salvaBozza() {
    const p = personaScelta(), lista = modifiche(), nn = nomeNuovo(); if (!p || (!lista.length && nn === undefined)) return;
    const io = p.id === S.utente.id;
    // l'unica domanda: chi toglie a sé stesso il ruolo di titolare in una sede perde la gestione di quella sede
    const perdo = io ? lista.filter(s => p.ruoli[s.id] === 'titolare' && P.bozza[s.id] !== 'titolare') : [];
    if (perdo.length && !confirm('Non sarai più titolare di ' + perdo.map(s => s.nome).join(', ') + ': non potrai più gestirne utenti e impostazioni. Continuare?')) return;
    const fatto = { aggiunta: [], tolta: [], ruolo: [], nome: false };
    dlgP.querySelectorAll('.p-azioni button').forEach(x => { x.disabled = true; });
    const salva = dlgP.querySelector('[data-psalva]'); if (salva) salva.textContent = 'Salvataggio…';
    try {
      if (nn !== undefined) { const { error } = await sb.rpc('imposta_nome', { u: p.id, n: nn }); if (error) throw error; fatto.nome = true; P.nome = null; }
      for (const s of lista) {
        const prima = p.ruoli[s.id] || '', dopo = P.bozza[s.id] || '';
        if (!prima) { await chiamaFunzione('utenti', { carrozzeria_id: s.id, email: p.email, ruolo: dopo, indirizzo: indirizzo() }); fatto.aggiunta.push(s.nome); }
        else {
          const q = sb.from('membri');
          const { error } = dopo ? await q.update({ ruolo: dopo }).eq('carrozzeria_id', s.id).eq('user_id', p.id) : await q.delete().eq('carrozzeria_id', s.id).eq('user_id', p.id);
          if (error) throw error;
          (dopo ? fatto.ruolo : fatto.tolta).push(s.nome);
        }
      }
      P.bozza = null;
      if (perdo.length || (io && fatto.tolta.length)) { dlgP.close(); return aggiorna(); }
      const parti = [fatto.nome && (nn ? 'nome «' + nn + '»' : 'nome tolto'), fatto.aggiunta.length && 'aggiunto a ' + fatto.aggiunta.join(', '), fatto.tolta.length && 'tolto da ' + fatto.tolta.join(', '), fatto.ruolo.length && 'ruolo cambiato in ' + fatto.ruolo.join(', ')].filter(Boolean);
      ricaricaPersone('', 'Salvato: ' + p.email + ': ' + parti.join('; ') + '.');
    } catch (e) {
      // la bozza resta: dopo la rilettura contano come modifiche solo le sedi non ancora salvate
      const m = e.message || '';
      ricaricaPersone((fatto.nome || fatto.aggiunta.length + fatto.tolta.length + fatto.ruolo.length ? 'Salvato solo in parte; il resto è ancora da salvare. ' : '') + (/almeno un titolare/i.test(m) ? 'ogni carrozzeria deve avere almeno un titolare.' : /amministratore/i.test(m) ? 'l’amministratore non può cambiare ruolo né essere rimosso.' : testoErrore(e)));
    }
  }
  async function aggiungiPersona(form) {
    const campi = new FormData(form), nome = String(campi.get('nome') || '').trim().replace(/\s+/g, ' '), email = String(campi.get('email') || '').trim(), ruolo = String(campi.get('ruolo')), sedi = campi.getAll('sede').map(String);
    // errori accanto al campo, senza ridisegnare: quanto scritto resta
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erroreCampo(form, form.querySelector('[name=email]'), 'Scrivi un’email valida.');
    if (!sedi.length) return erroreCampo(form, form.querySelector('.p-sedi'), 'Spunta almeno una sede.');
    erroreCampo(form);
    const invia = form.querySelector('[type=submit]'); invia.disabled = true; invia.textContent = 'Aggiungo…';
    let invitato = false, fatte = 0;
    try {
      // una sede alla volta: la prima invita (se serve), le altre aggiungono la persona già registrata
      for (const c of sedi) { const r = await chiamaFunzione('utenti', { carrozzeria_id: c, email, ruolo, indirizzo: indirizzo() }); invitato = invitato || r.esito === 'invitato'; fatte++; }
      // il nome si scrive quando la persona è nella sede (lo permette il database solo a chi è titolare di una sua sede)
      if (nome) { const d = await leggiPersone(), q = d.persone.find(x => x.email.toLowerCase() === email.toLowerCase()); if (q) await sb.rpc('imposta_nome', { u: q.id, n: nome }); }
      P.email = ''; ricaricaPersone('', (invitato ? 'Invito inviato a ' + email + '. ' : '') + email + ' aggiunto come ' + RUOLI[ruolo] + (sedi.length > 1 ? ' in ' + fatte + ' sedi.' : '.'), email);
    } catch (e) {
      if (fatte) return ricaricaPersone('Aggiunto in ' + fatte + (fatte === 1 ? ' sede' : ' sedi') + ', poi: ' + testoErrore(e), '', email);
      invia.disabled = false; invia.textContent = 'Aggiungi';
      erroreCampo(form, form.querySelector('[name=email]'), testoErrore(e));
    }
  }

  /* ---------------------------------------------- menu dell'account (2026-11-05, scelto dal titolare): in alto a destra in
     tutte le pagine (carrozzerie, Gestore, planner) il cerchio con l'iniziale e l'email; il menu dice con quale account e
     ruolo si è entrati e contiene «Esci». È della pagina di accesso, non del planning: il server non lo vede. */
  let conto = null, menuConto = null, sedeAperta = null;
  const FRECCIA = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const SCHERMO = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
  const ESCI = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>';
  // ruolo e dove (2026-11-05): l'email, spesso lunga, si legge passando con il mouse (title) e la sente il lettore di schermo
  function chiSono() {
    if (S.simula) return { ruolo: RUOLI[S.simula] + ' · simulazione', dove: sedeAperta ? sedeAperta.nome : 'Simulazione' };
    if (sedeAperta) return { ruolo: S.admin ? 'Amministratore' : RUOLI[sedeAperta.ruolo] || '', dove: sedeAperta.nome };
    if (S.admin) return { ruolo: 'Amministratore', dove: 'tutte le carrozzerie' };
    const v = vive(), ruoli = [...new Set(v.map(s => s.ruolo))];
    return { ruolo: ruoli.length === 1 ? RUOLI[ruoli[0]] : 'Più ruoli', dove: v.length === 1 ? v[0].nome : v.length + ' sedi' };
  }
  function mostraConto() {
    if (!S.utente) return togliConto();
    if (!conto) {
      conto = document.createElement('div'); conto.id = 'conto';
      // in simulazione l'icona riporta subito alle piene funzioni di amministratore
      conto.addEventListener('click', ev => { if (ev.target.closest('[data-conto]')) { ev.stopPropagation(); if (S.simula) return simula(''); apriMenuConto(!menuConto); } });
      conto.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'ArrowDown' && !menuConto) { ev.preventDefault(); apriMenuConto(true); } });
    }
    const email = S.utente.email || '', chi = chiSono(), ini = (S.nome || email).charAt(0).toUpperCase();
    conto.innerHTML = S.simula ? `<button type="button" class="conto-btn simula" data-conto="1" title="Simulazione: ${esc(RUOLI[S.simula])}. Clic per tornare amministratore" aria-label="Simulazione del ruolo ${esc(RUOLI[S.simula])}: torna amministratore">
      <span class="conto-ini" aria-hidden="true">${esc(ini)}</span><span class="conto-ruolo" aria-hidden="true">${esc(chi.ruolo)}</span><span class="conto-torna">Torna amministratore</span></button>`
      : `<button type="button" class="conto-btn" data-conto="1" aria-haspopup="menu" aria-expanded="${!!menuConto}" aria-controls="menuConto" title="${esc(S.nome ? S.nome + ' – ' + email : email)}" aria-label="Account ${esc(email)}, ${esc(chi.ruolo)}">
      <span class="conto-ini" aria-hidden="true">${esc(ini)}</span><span class="conto-ruolo" aria-hidden="true">${esc(chi.ruolo)}</span>${FRECCIA}</button>`;
    // nella pagina delle carrozzerie scorre con la pagina (che sta sopra a tutto); nel planner resta fermo in alto
    const dove = !sedeAperta && box && box.isConnected ? box : document.body; if (conto.parentNode !== dove) dove.appendChild(conto);
    document.body.classList.toggle('con-planner', !!sedeAperta);
  }
  function togliConto() { chiudiMenuConto(false); if (conto) { conto.remove(); conto = null; } document.body.classList.remove('con-planner'); }
  function apriMenuConto(si) {
    if (!si) return chiudiMenuConto(true);
    menuConto = document.createElement('div'); menuConto.id = 'menuConto'; menuConto.setAttribute('role', 'menu'); menuConto.setAttribute('aria-label', 'Account');
    const email = S.utente.email || '', chi = chiSono();
    // l'amministratore, dentro una carrozzeria, può vedere il planner come gli altri ruoli (le modifiche non si salvano)
    const vediCome = S.admin && sedeAperta ? `<div class="mc-sez" role="group" aria-label="Vedi il planner come"><span class="mc-tit">Vedi il planner come</span>${Object.entries(RUOLI).map(([k, t]) => `<button type="button" role="menuitem" class="mc-voce mc-ruolo" data-simula="${k}">${esc(t)}</button>`).join('')}<span class="mc-nota">Solo per vedere: le modifiche non si salvano. Clic sull’icona per tornare amministratore.</span></div>` : '';
    menuConto.innerHTML = `<div class="mc-chi" title="${esc(email)}"><span class="conto-ini grande" aria-hidden="true">${esc((S.nome || email).charAt(0).toUpperCase())}</span>
      <div><span class="mc-nasc">Account ${esc(email)}: </span>${S.nome ? `<b class="mc-nome">${esc(S.nome)}</b>` : ''}<b>${esc(chi.ruolo)}</b><span>${esc(chi.dove)}</span></div></div>
      ${vediCome}${sedeAperta && !S.simula ? `<button type="button" role="menuitem" class="mc-voce" data-tabellone="1">${SCHERMO}Apri il tabellone dell’officina</button>` : ''}<button type="button" role="menuitem" class="mc-voce" data-conto-esci="1">${ESCI}Esci</button>`;
    conto.appendChild(menuConto);
    conto.querySelector('[data-conto]').setAttribute('aria-expanded', 'true');
    menuConto.addEventListener('click', async ev => {
      ev.stopPropagation();
      const r = ev.target.closest('[data-simula]'); if (r) return simula(r.dataset.simula);
      // il tabellone si apre in una scheda nuova, da portare a tutto schermo (F11) sullo schermo dell'officina
      if (ev.target.closest('[data-tabellone]')) { chiudiMenuConto(false); window.open(location.pathname + location.search + '#c=' + sedeAperta.id + '&tabellone=1', '_blank', 'noopener'); return; }
      if (ev.target.closest('[data-conto-esci]')) { try { sessionStorage.removeItem(SIMULA); } catch (e) { } try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { } await sb.auth.signOut(); location.reload(); }
    });
    menuConto.addEventListener('keydown', ev => {
      const voci = [...menuConto.querySelectorAll('[role=menuitem]')], i = voci.indexOf(document.activeElement);
      if (ev.key === 'Escape') { ev.preventDefault(); chiudiMenuConto(true); }
      else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); voci[(i + (ev.key === 'ArrowDown' ? 1 : voci.length - 1)) % voci.length].focus(); }
      else if (ev.key === 'Tab') chiudiMenuConto(false);
    });
    menuConto.querySelector('[role=menuitem]').focus();
    setTimeout(() => document.addEventListener('click', fuoriConto, true));
  }
  function fuoriConto(ev) { if (conto && !conto.contains(ev.target)) chiudiMenuConto(false); }
  function chiudiMenuConto(fuoco) {
    document.removeEventListener('click', fuoriConto, true);
    if (menuConto) { menuConto.remove(); menuConto = null; }
    const b = conto && conto.querySelector('[data-conto]'); if (b) { b.setAttribute('aria-expanded', 'false'); if (fuoco) b.focus(); }
  }

  /* ---------------------------------------------- avvio */
  let passwordFatta = false;
  async function avvia(ok = '') {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return mostraAccesso('accedi', ERRORE_LINK ? 'Il link non è più valido: chiedi un nuovo invito o usa «Password dimenticata?».' : '');
    S.utente = session.user;
    if (!ok && (TIPO_LINK === 'invite' || TIPO_LINK === 'recovery') && !passwordFatta) { passwordFatta = true; return mostraAccesso('password'); }
    passwordFatta = true;
    try { await caricaElenco(); } catch (e) { S.msg = testoErrore(e); }
    // una sola carrozzeria e nessun ruolo di supervisione: si entra direttamente nel calendario (2026-11-04).
    // Il titolare ritorna alla pagina delle carrozzerie (utenti, nome) con il pulsante del nome: «planning-elenco».
    let elenco = false; try { elenco = sessionStorage.getItem('planning-elenco') === '1'; sessionStorage.removeItem('planning-elenco'); } catch (e) { }
    // tabellone dell'officina: #c=…&tabellone=1 nell'indirizzo (aperto dal menu dell'account, o salvato sullo schermo)
    const arrivo = new URLSearchParams(location.hash.slice(1)), ct = arrivo.get('c');
    if (arrivo.get('tabellone') && ct && voce(ct) && !voce(ct).eliminata_il) return apri(ct, '', 'tabellone');
    const unica = vive().length === 1 && !vedeGestore() ? vive()[0] : null;
    if (unica && !elenco) return apri(unica.id, titolareDi(unica) ? 'elenco' : 'esci');
    // come nel planning originale, #c=… nell'indirizzo riapre direttamente quella carrozzeria
    const c = new URLSearchParams(location.hash.slice(1)).get('c');
    if (c && voce(c) && !voce(c).eliminata_il && !elenco) return apri(c);
    S.ok = ok; mostraElenco();
  }
  document.addEventListener('click', async ev => {
    const b = ev.target.closest && ev.target.closest('.sedechip[data-sola]'); if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { }
    try { sessionStorage.setItem('planning-elenco', '1'); } catch (e) { }
    location.reload();
  }, true);
  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && S.utente) { S.utente = null; location.reload(); } });
  return { avvia, pagina };
})();
Accesso.pagina().innerHTML = '<div class="lcard"><div class="lhead"><h1>Pianificazione Carrozzeria</h1><p>Caricamento…</p></div></div>';
Accesso.avvia();
