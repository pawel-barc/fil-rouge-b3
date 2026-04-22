/**Composant Input réutilisable
 * Input de base utilisé dans tous les formulaires
 */

import type { InputHTMLAttributes } from "react";

/**Props du composant Input hérite de tous les attributs natif d'un <input> HTML et ajoute une propriété personnalisée "hasError" */
type Props = InputHTMLAttributes<HTMLInputElement> & {
  hasError?: boolean;
};

/**Composant Input générique et réutilisable */
export default function Input({ hasError, ...props }: Props) {
  return (
    <input
      /**On applique tous les atributs standards de l'input (type, value, onChange...)*/
      {...props}
      /**Accessibilité : indique aux lecteurs d'écran si le champ est invalide */
      aria-invalid={hasError}
      /**Classe CSS dynamique
       * - "input" : style de base
       * - "input--error" : style appliqué si erreur de validation  */
      className={`input ${hasError ? "input-error" : ""}`}
    />
  );
}
