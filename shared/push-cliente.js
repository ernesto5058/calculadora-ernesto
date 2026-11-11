/* =====================================================================
   AVISOS — cliente Web Push propio (VAPID) compartido por las dos PWA.
   La clave PÚBLICA VAPID no es secreta: va aquí y en el cliente.
   La PRIVADA vive SOLO como secreto de la Edge Function «avisos».
   Reglas de Apple (WebKit): el permiso se pide SOLO tras un toque del
   usuario y solo funciona desde la app INSTALADA (iOS 16.4+).
   La registración de la suscripción la hace cada app con SU puerta
   (registrar_push / registrar_push_admin): este módulo solo sabe
   pedir permiso y suscribir; el guardado lo inyecta la app.
   ===================================================================== */
var VAPID_PUBLICA = "BFkHoyMQce-Nm3HBK7sStWyiQsIVxeJ7w41yWD3qTCwQWhqv7F4V3UcqP0Lrgb8WWG_u-z3begmlF4LKL9L5toM";

function vapidBytes(base64url){
  var pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  var b64 = (base64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  var raw = atob(b64);
  var arr = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
function esIOS(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
}
function estaInstalada(){
  try {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.navigator.standalone === true) return true; /* iOS clásico */
  } catch(e){}
  return false;
}
/* Estado para pintar el botón: 'ok' | 'denegado' | 'instalar' | 'navegador' | 'sin-soporte' */
function estadoPush(){
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    if (esIOS() && !estaInstalada()) return "instalar";
    return "sin-soporte";
  }
  if (Notification.permission === "denied") return "denegado";
  if (Notification.permission === "granted") return "ok";
  if (esIOS() && !estaInstalada()) return "instalar";
  return "pedir";
}
/* Debe llamarse DENTRO del toque del usuario (requisito Apple).
   guardar(suscripcionJson, plataforma) -> Promise de la app. */
function activarPush(guardar){
  if (!("serviceWorker" in navigator)) return Promise.reject(new Error("sin service worker"));
  return navigator.serviceWorker.ready.then(function(reg){
    return Notification.requestPermission().then(function(perm){
      if (perm !== "granted") throw new Error("permiso no concedido");
      return reg.pushManager.getSubscription().then(function(sub){
        if (sub) return sub;
        return reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidBytes(VAPID_PUBLICA)
        });
      });
    }).then(function(sub){
      var plataforma = esIOS() ? "ios" : (/android/i.test(navigator.userAgent || "") ? "android" : "web");
      return guardar(sub.toJSON(), plataforma);
    });
  });
}
