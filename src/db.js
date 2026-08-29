/**
 * PAP-LFI — Couche base de données Supabase
 * 
 * Tables (à créer dans Supabase) :
 * - actions : les campagnes de porte-à-porte
 * - doors : chaque porte visitée (données chiffrées)
 * 
 * Les données sont chiffrées côté application (AES-256-GCM) avant stockage,
 * donc même si la BDD Supabase est compromise, tout reste illisible.
 * 
 * 🔒 Sécurité : on utilise la clé service_role (qui contourne la RLS) côté
 * serveur UNIQUEMENT. La clé anon (publique) n'est plus utilisée par l'app :
 * elle est retirée de la RLS. Si la clé anon fuit, elle ne permet plus rien.
 * 
 * ⚠️ Transition : tant que SUPABASE_SERVICE_ROLE_KEY n'est pas définie sur la
 * plateforme, on retombe sur la clé anon (avec un avertissement bien visible)
 * pour ne pas casser le déploiement en cours. À retirer une fois la migration faite.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  console.error('❌ Variable SUPABASE_URL requise.');
}

let supabase;
if (SERVICE_KEY) {
  // Mode sécurisé : service_role (contourne la RLS). Les policies anon peuvent être retirées.
  supabase = createClient(SUPABASE_URL || '', SERVICE_KEY);
  console.log('🔒 Supabase connecté avec service_role (sécurisé).');
} else if (ANON_KEY) {
  // ⚠️ Mode transition : anon utilisé en attendant que SUPABASE_SERVICE_ROLE_KEY soit définie.
  // Non sécurisé contre une fuite de la clé anon — à remplacer dès que possible.
  console.warn('⚠️ SUPABASE_SERVICE_ROLE_KEY manquante. Fallback sur SUPABASE_ANON_KEY (transition). Configurez service_role !');
  supabase = createClient(SUPABASE_URL || '', ANON_KEY);
} else {
  console.error('❌ Ni SUPABASE_SERVICE_ROLE_KEY ni SUPABASE_ANON_KEY définies.');
  supabase = createClient(SUPABASE_URL || '', '');
}

module.exports = supabase;
