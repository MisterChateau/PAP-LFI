/**
 * PAP-LFI — Couche base de données Supabase
 * 
 * Tables (à créer dans Supabase) :
 * - actions : les campagnes de porte-à-porte
 * - doors : chaque porte visitée (données chiffrées)
 * 
 * Les données sont chiffrées côté application (AES-256-GCM) avant stockage,
 * donc même si la BDD Supabase est compromise, tout reste illisible.
 */

const { createClient } = require('@supabase/supabase-js');

// Les identifiants viennent des variables d'environnement (configurées sur Render)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Variables SUPABASE_URL et SUPABASE_ANON_KEY requises.');
  console.error('   Configurez-les dans votre plateforme d\'hébergement ou un fichier .env');
}

const supabase = createClient(SUPABASE_URL || '', SUPABASE_KEY || '');

module.exports = supabase;
