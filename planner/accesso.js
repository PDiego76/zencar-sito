'use strict';
/* Pianificazione Carrozzeria – accesso, scelta della carrozzeria, utenti.
   Collegamento con Supabase (sb) e con le funzioni sul server (chiamaFunzione), usati anche da planning.js. */
const { url: SB_URL, chiave: SB_CHIAVE } = window.CONFIG;
// i link di invito e di recupero password arrivano con #…&type=invite|recovery (letti prima che supabase-js li tolga)
const ARRIVO = new URLSearchParams(location.hash.slice(1));
const TIPO_LINK = ARRIVO.get('type'), ERRORE_LINK = ARRIVO.get('error_description');
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
  const RUOLI = { titolare: 'Titolare', accettazione: 'Accettazione', officina: 'Officina', amministrazione: 'Amministrazione' };
  const SPIEGA = {
    titolare: 'tutto, compresi utenti, copie e ripristini',
    accettazione: 'vetture, operai, impostazioni, importi, copie',
    officina: 'consulta e segna le fasi fatte; non vede gli importi',
    amministrazione: 'consulta, gestisce importi e copie; non modifica le vetture'
  };
  const PW_MIN = 10;
  const S = { utente: null, voci: [], menu: null, modifica: null, msg: '', ok: '' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const indirizzo = () => location.origin + location.pathname;
  const voce = id => S.voci.find(s => s.id === id);
  const ultima = () => { try { return localStorage.getItem('planning-sede-ultima') || ''; } catch (e) { return ''; } };
  let box = null, dlg = null;

  function pagina() {
    if (!box) {
      box = document.createElement('div'); box.id = 'landing'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Scegli la carrozzeria');
      document.body.appendChild(box);
      box.addEventListener('click', clic); box.addEventListener('submit', ev => { ev.preventDefault(); if (ev.target.dataset.modoForm) inviaAccesso(ev.target); });
      box.addEventListener('keydown', tasti);
    }
    return box;
  }

  function testoErrore(e) {
    const m = (e && (e.errore || e.message)) || String(e);
    if (/Invalid login credentials/i.test(m)) return 'Email o password non corretti.';
    if (/Email not confirmed/i.test(m)) return 'Email non ancora confermata: usa il link dell’invito.';
    if (/Password should be at least/i.test(m)) return 'La password deve avere almeno ' + PW_MIN + ' caratteri.';
    if (/should be different/i.test(m)) return 'La nuova password deve essere diversa da quella attuale.';
    if (/rate limit|too many/i.test(m)) return 'Troppi tentativi: riprova tra qualche minuto.';
    if (/carrozzerie_nome_unico|duplicate key/i.test(m)) return 'C’è già una carrozzeria con questo nome.';
    if (/Failed to fetch|NetworkError|Load failed|Connessione/i.test(m)) return 'Connessione non riuscita: controlla la rete e riprova.';
    if (/JWT|session/i.test(m)) return 'La sessione è scaduta: accedi di nuovo.';
    return m;
  }

  /* ---------------------------------------------- accesso */
  function mostraAccesso(modo = 'accedi', msg = '', ok = '') {
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
    pagina().innerHTML = `<div class="lcard stretta"><div class="lhead"><h1>Pianificazione Carrozzeria</h1><p>${M.sotto}</p></div>
      ${msg ? `<p class="lerr" role="alert">${esc(msg)}</p>` : ''}${ok ? `<p class="lok" role="status">${esc(ok)}</p>` : ''}
      <form class="modulo" data-modo-form="${modo}" novalidate>${M.campi}<button type="submit" class="btn pri">${M.pulsante}</button>${M.fondo ? `<div>${M.fondo}</div>` : ''}</form></div>`;
    const f = box.querySelector('input'); if (f) f.focus();
  }

  async function inviaAccesso(form) {
    const modo = form.dataset.modoForm, v = Object.fromEntries(new FormData(form));
    const errore = m => mostraAccesso(modo, m);
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
    const { data, error } = await sb.from('membri').select('ruolo, carrozzerie(id, numero, nome, eliminata_il)').eq('user_id', S.utente.id);
    if (error) throw error;
    S.voci = data.filter(r => r.carrozzerie).map(r => Object.assign({}, r.carrozzerie, { ruolo: r.ruolo }))
      .sort((a, b) => (a.numero ?? 1e9) - (b.numero ?? 1e9) || a.nome.localeCompare(b.nome, 'it'));
  }
  const vive = () => S.voci.filter(s => !s.eliminata_il);
  const titolareDi = s => s.ruolo === 'titolare';
  function nomeErrore(nome, id) {
    if (!nome) return 'Scrivi un nome.';
    if (nome.length > 60) return 'Il nome può avere al massimo 60 caratteri.';
    if (vive().some(s => s.id !== id && s.nome.toLowerCase() === nome.toLowerCase())) return 'C’è già una carrozzeria con questo nome.';
    return '';
  }
  const GEAR = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  function landingHtml() {
    const last = ultima();
    const modifica = (id, nome) => `<div class="lcardi editing"><input type="text" maxlength="60" value="${esc(nome)}" data-edit="${id}" aria-label="Nome della carrozzeria">
      <div class="lact"><button type="button" class="pri" data-save="${id}">Salva</button><button type="button" data-cancel="1">Annulla</button></div></div>`;
    const card = s => {
      if (S.modifica === s.id) return modifica(s.id, s.nome);
      const menu = S.menu === s.id ? `<div class="lmenu" role="menu"><button type="button" role="menuitem" data-ren="${s.id}">Rinomina</button>
        <button type="button" role="menuitem" data-utenti="${s.id}">Utenti</button><button type="button" role="menuitem" class="del" data-del="${s.id}">Elimina</button></div>` : '';
      return `<div class="lcardi${s.id === last ? ' last' : ''}"><button type="button" class="lopen" data-sede="${s.id}">${esc(s.nome)}<small>${esc(RUOLI[s.ruolo])}${s.id === last ? ' · Ultima usata' : ''}</small></button>
        ${titolareDi(s) ? `<button type="button" class="lgear" data-menu="${s.id}" aria-haspopup="menu" aria-expanded="${S.menu === s.id}" aria-label="Impostazioni di ${esc(s.nome)}" title="Impostazioni">${GEAR}</button>${menu}` : ''}</div>`;
    };
    const puoAggiungere = S.voci.some(titolareDi);
    const nuova = S.modifica === 'nuova' ? modifica('nuova', 'Carrozzeria ' + (vive().length + 1)) : (puoAggiungere ? '<button type="button" class="ladd" data-add="1">+ Aggiungi carrozzeria</button>' : '');
    const gone = S.voci.filter(s => s.eliminata_il && titolareDi(s));
    return `<div class="lcard"><div class="lhead"><h1>Pianificazione Carrozzeria</h1><p>Scegli la carrozzeria: ognuna ha operai, vetture e impostazioni separati.</p></div>
      <div class="lbar"><span>Accesso come <strong>${esc(S.utente.email)}</strong></span><button type="button" class="esci" data-esci="1">Esci</button></div>
      ${S.msg ? `<p class="lerr" role="alert">${esc(S.msg)}</p>` : ''}${S.ok ? `<p class="lok" role="status">${esc(S.ok)}</p>` : ''}
      ${vive().length || nuova ? `<div class="lgrid">${vive().map(card).join('')}${nuova}</div>`
        : '<p class="lnote">Non hai ancora accesso a nessuna carrozzeria: chiedi al titolare di aggiungerti.</p>'}
      ${gone.length ? `<details class="lgone"><summary>Carrozzerie eliminate (${gone.length})</summary><p class="lnote">Restano recuperabili finché non le elimini definitivamente.</p>
        ${gone.map(s => `<div class="lgrow"><span>${esc(s.nome)}</span><button type="button" data-restore="${s.id}">Ripristina</button><button type="button" class="del" data-wipe="${s.id}">Elimina definitivamente</button></div>`).join('')}</details>` : ''}
      <p class="lnote">Per tornare a questa pagina usa il pulsante con il nome della carrozzeria, in alto a destra.</p></div>`;
  }
  function mostraElenco(focusSel) {
    pagina().innerHTML = landingHtml();
    const f = (focusSel && box.querySelector(focusSel)) || box.querySelector('[data-edit]') || box.querySelector('.last .lopen') || box.querySelector('.lopen');
    if (f) { f.focus(); if (f.matches('input')) f.select(); }
  }
  async function aggiorna(ok = '') {
    S.menu = null; S.modifica = null; S.ok = ok;
    try { await caricaElenco(); S.msg = ''; } catch (e) { S.msg = testoErrore(e); }
    mostraElenco();
  }
  async function salvaNome(id) {
    const inp = box.querySelector(`[data-edit="${id}"]`);
    const nome = (inp ? inp.value : '').trim().replace(/\s+/g, ' ');
    const err = nomeErrore(nome, id);
    if (err) { S.msg = err; S.ok = ''; return mostraElenco(); }
    try {
      if (id === 'nuova') { const { error } = await sb.rpc('crea_carrozzeria', { nome }); if (error) throw error; }
      else { const { error } = await sb.from('carrozzerie').update({ nome }).eq('id', id); if (error) throw error; }
      await aggiorna();
    } catch (e) { S.msg = testoErrore(e); S.ok = ''; mostraElenco(); }
  }

  async function clic(ev) {
    const m = ev.target.closest('[data-modo]'); if (m) return mostraAccesso(m.dataset.modo);
    if (!S.utente) return;
    const t = ev.target.closest('button');
    if (!t) { if (S.menu) { S.menu = null; mostraElenco(); } return; }
    if (t.dataset.esci) { await sb.auth.signOut(); S.utente = null; return mostraAccesso(); }
    S.msg = ''; S.ok = '';
    if (t.dataset.menu) { const id = t.dataset.menu; S.menu = S.menu === id ? null : id; return mostraElenco(S.menu ? `.lmenu [data-ren="${id}"]` : `[data-menu="${id}"]`); }
    S.menu = null;
    if (t.dataset.sede) return apri(t.dataset.sede);
    if (t.dataset.ren) { S.modifica = t.dataset.ren; return mostraElenco(); }
    if (t.dataset.add) { S.modifica = 'nuova'; return mostraElenco(); }
    if (t.dataset.cancel) { S.modifica = null; return mostraElenco(); }
    if (t.dataset.save) return salvaNome(t.dataset.save);
    if (t.dataset.utenti) return apriUtenti(t.dataset.utenti);
    try {
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
    if (ev.target.matches && ev.target.matches('[data-edit]')) {
      if (ev.key === 'Enter') { ev.preventDefault(); salvaNome(ev.target.dataset.edit); }
      if (ev.key === 'Escape') { ev.preventDefault(); S.modifica = null; mostraElenco(); }
    } else if (ev.key === 'Escape' && S.menu) { const id = S.menu; S.menu = null; mostraElenco(`[data-menu="${id}"]`); }
    ev.stopPropagation(); // le scorciatoie del planning restano spente
  }

  /** Apre il planning della carrozzeria scelta. */
  function apri(id) {
    const s = voce(id); if (!s || s.eliminata_il) return aggiorna();
    try { history.replaceState(null, '', location.pathname + location.search + '#c=' + id); } catch (e) { }
    if (box) { box.remove(); box = null; }
    bootSede(s);
  }

  /* ---------------------------------------------- utenti di una carrozzeria (solo titolare) */
  function finestra() {
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.id = 'dlgUtenti'; dlg.setAttribute('aria-label', 'Utenti della carrozzeria');
      document.body.appendChild(dlg);
      dlg.addEventListener('click', ev => {
        if (ev.target === dlg || ev.target.closest('[data-x]')) return dlg.close();
        const r = ev.target.closest('[data-rimuovi]'); if (r) cambiaMembro(r.dataset.rimuovi, null);
      });
      dlg.addEventListener('change', ev => { const s = ev.target.closest('[data-ruolo]'); if (s) cambiaMembro(s.dataset.ruolo, s.value); });
      dlg.addEventListener('submit', ev => { ev.preventDefault(); invita(ev.target); });
      dlg.addEventListener('keydown', ev => ev.stopPropagation());
    }
    return dlg;
  }
  async function apriUtenti(id) {
    const s = voce(id), d = finestra();
    d.innerHTML = `<div class="dh"><h3>Utenti – ${esc(s.nome)}</h3><button class="x" type="button" data-x="1" aria-label="Chiudi">×</button></div><div class="db"><p class="lnote">Caricamento…</p></div>`;
    d.dataset.sede = id;
    if (!d.open) d.showModal();
    await disegnaUtenti();
  }
  async function disegnaUtenti(msg = '', ok = '') {
    const s = voce(dlg.dataset.sede);
    const { data, error } = await sb.rpc('utenti_carrozzeria', { c: s.id });
    const opzioni = r => Object.entries(RUOLI).map(([k, n]) => `<option value="${k}"${k === r ? ' selected' : ''}>${n}</option>`).join('');
    const righe = error ? `<p class="lerr">${esc(testoErrore(error))}</p>` : data.map(u => `<div class="riga"><span class="chi">${esc(u.email)}${u.user_id === S.utente.id ? ' (tu)' : ''}
        <small>${u.attivo ? 'Ha già effettuato l’accesso' : 'Invito in attesa: non ha ancora effettuato l’accesso'}</small></span>
        <select data-ruolo="${u.user_id}" aria-label="Ruolo di ${esc(u.email)}">${opzioni(u.ruolo)}</select>
        <button type="button" class="btn sm danger" data-rimuovi="${u.user_id}">Rimuovi</button></div>`).join('');
    dlg.querySelector('.db').innerHTML = `${msg ? `<p class="lerr" role="alert">${esc(msg)}</p>` : ''}${ok ? `<p class="lok" role="status">${esc(ok)}</p>` : ''}
      <div>${righe}</div>
      <form class="invita" novalidate><label>Aggiungi una persona (email)<input type="email" name="email" maxlength="200" required autocomplete="off"></label>
        <label>Ruolo<select name="ruolo">${opzioni('officina')}</select></label><button type="submit" class="btn pri">Aggiungi</button></form>
      <ul class="ruoli">${Object.entries(SPIEGA).map(([k, t]) => `<li><strong>${RUOLI[k]}</strong>: ${esc(t)}</li>`).join('')}</ul>
      <p class="lnote">Se l’email non ha ancora un account, la persona riceve un invito per scegliere la password.</p>`;
  }
  async function cambiaMembro(utenteId, ruolo) {
    const c = dlg.dataset.sede, io = utenteId === S.utente.id;
    if (io && ruolo !== 'titolare' && !confirm(ruolo ? 'Cambiando il tuo ruolo non potrai più gestire utenti e impostazioni di questa carrozzeria. Continuare?' : 'Rimuovendoti perderai l’accesso a questa carrozzeria. Continuare?')) return disegnaUtenti();
    if (!io && !ruolo && !confirm('Rimuovere questa persona dalla carrozzeria?')) return;
    const q = sb.from('membri');
    const { error } = ruolo ? await q.update({ ruolo }).eq('carrozzeria_id', c).eq('user_id', utenteId) : await q.delete().eq('carrozzeria_id', c).eq('user_id', utenteId);
    if (error) return disegnaUtenti(/almeno un titolare/i.test(error.message) ? 'Ogni carrozzeria deve avere almeno un titolare.' : testoErrore(error));
    if (io) { dlg.close(); return aggiorna(); }
    disegnaUtenti('', ruolo ? 'Ruolo aggiornato.' : 'Persona rimossa.');
  }
  async function invita(form) {
    const v = Object.fromEntries(new FormData(form)), email = (v.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return disegnaUtenti('Scrivi un’email valida.');
    form.querySelector('[type=submit]').disabled = true;
    try {
      const r = await chiamaFunzione('utenti', { carrozzeria_id: dlg.dataset.sede, email, ruolo: v.ruolo, indirizzo: indirizzo() });
      disegnaUtenti('', r.esito === 'invitato' ? 'Invito inviato a ' + email + ': riceverà un’email per scegliere la password.' : email + ' aggiunto alla carrozzeria.');
    } catch (e) { disegnaUtenti(testoErrore(e)); }
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
    // come nel planning originale, #c=… nell'indirizzo riapre direttamente quella carrozzeria
    const c = new URLSearchParams(location.hash.slice(1)).get('c');
    if (c && voce(c) && !voce(c).eliminata_il) return apri(c);
    S.ok = ok; mostraElenco();
  }
  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && S.utente) { S.utente = null; location.reload(); } });
  return { avvia, pagina };
})();
Accesso.pagina().innerHTML = '<div class="lcard"><div class="lhead"><h1>Pianificazione Carrozzeria</h1><p>Caricamento…</p></div></div>';
Accesso.avvia();
