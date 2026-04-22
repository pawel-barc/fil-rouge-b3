/**Composant FormField - wrapper pour label + input + message d'erreur
 * Améliore l'accessibilité et la cohérence UI*/

import type { ReactNode } from "react";

type Props = {
  label: string; // Texte affiché dans le label
  htmlFor: string;
  error?: string; // Message d'erreur éventuel
  children: ReactNode; // Contenu du champ (input, select, textarea...)
};

export default function FormField({ label, htmlFor, error, children }: Props) {
  return (
    <div className="form-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {/*Affichage conditionnel du message d'erreur*/}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
