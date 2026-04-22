/**Componant Button réutilisable, gére les différents états (disabled / loading)  */
import type { ButtonHTMLAttributes } from "react";

/**Props du composant Button hérite de tous les attributs natif d'un <button> HTML et ajoute un état de chargement (loading) */
type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
};
/**Composant Loader (spinner simple CSS), utilisé à l'intérieur du bouton pendant le chargement */
function Loader() {
  return <span className="spinner" aria-hidden="true" />;
}

/**Bouton réutilisable avec état de chargement */
export default function Button({
  loading,
  disabled,
  children,
  ...props
}: Props) {
  return (
    /**Désactive le bouton si loading */
    <button
      {...props}
      disabled={loading || disabled}
      /**Accessibilité : indique qu'un chargement est en cours */
      aria-busy={loading}
      className={`btn ${loading ? "btn--loading" : ""}`}
    >
      {loading ? (
        <span className="btn_content">
          <Loader />
          Chargement...
        </span>
      ) : (
        children
      )}
    </button>
  );
}
