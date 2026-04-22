/**Affiche un message de succès */

type Props = {
  message: string;
};

export default function SuccessMessage({ message }: Props) {
  return (
    <p role="status" style={{ color: "green" }}>
      {message}
    </p>
  );
}
