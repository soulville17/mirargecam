/**
 * Gestion du watermark (logo MirageCam) sur le flux transforme.
 *
 * Le watermark est applique par l'API Decart en fonction de la CLE utilisee :
 *  - DECART_API_KEY                -> rend une video AVEC watermark (logo)
 *  - DECART_API_KEY_NO_WATERMARK   -> rend une video SANS watermark
 *
 * Contrairement au systeme de forfaits automatique de ChapCam, MirageCam
 * expose un simple bouton dans l'interface : le client demande explicitement
 * `/api/decart-token?no_watermark=1` et le serveur choisit la cle adaptee.
 * Le client ne voit JAMAIS les cles : il recoit seulement un token ephemere
 * deja lie a la bonne cle.
 */

/**
 * Renvoie la cle Decart a utiliser selon la preference de watermark.
 * Repli sur la cle avec watermark si la cle sans watermark n'est pas configuree.
 */
export function pickDecartApiKey(noWatermark: boolean): { apiKey: string | undefined; usedNoWatermark: boolean } {
  const withWm = process.env.DECART_API_KEY
  const withoutWm = process.env.DECART_API_KEY_NO_WATERMARK

  if (noWatermark && withoutWm) {
    return { apiKey: withoutWm, usedNoWatermark: true }
  }
  // Repli securise : si la cle sans watermark manque, on ne casse pas le swap,
  // on retombe sur la cle avec watermark.
  return { apiKey: withWm, usedNoWatermark: false }
}
