/**Ce fichier définit le type Company, il représente une entreprise / organisateur d'événements */
export type Company = {
  id: number;
  name: string;
  description: string;
  website?: string;
  address?: string;
  logo?: string;
  created_at?: string;
};
