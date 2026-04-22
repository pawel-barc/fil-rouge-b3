/**Affiche un message d'erreur accessible */
type Props = {
  message: string;
};

export default function ErrorMessage({ message }: Props) {
  return (
    <p role="alert" style={{ color: "red" }}>
      {message}
    </p>
  );
}
