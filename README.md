Plateforme d’événements géolocalisés

Description du projet

Ce projet consiste à développer une application web permettant aux utilisateurs de découvrir des événements autour d’eux de manière simple et rapide.

L’application centralise des événements provenant de différentes sources et les affiche sur une carte interactive. L’objectif est de faciliter l’accès à l’information locale, souvent dispersée sur plusieurs plateformes.

Objectifs

Centraliser les événements locaux
Faciliter leur découverte grâce à une carte interactive
Proposer une expérience personnalisée
Améliorer l’accessibilité des informations

Public cible

Habitants de la région
Étudiants
Touristes
Jeunes actifs
Associations et organisateurs d’événements

Fonctionnalités principales

Consultation des événements sur une carte interactive
Filtrage des événements (catégories, préférences)
Détail d’un événement (date, lieu, description, météo)
Création de compte utilisateur
Gestion des favoris et historique
Recommandations personnalisées
Notifications (PWA)
Ajout et gestion d’événements par les organisateurs

Choix techniques

Frontend
React
TypeScript
Leaflet (carte interactive)

Backend
Go (API REST)
Architecture en couches (Controller / Service / Repository)

Bases de données
PostgreSQL (données principales)
Redis (cache, sessions, performance)

Architecture

L’application suit une architecture classique en plusieurs couches :

Frontend → API REST → Middleware → Controller → Service → Repository → Base de données

Un système de scraping permet également de récupérer automatiquement des événements depuis des sources externes.

Sécurité

Authentification JWT
Gestion des rôles (utilisateur / admin / organisateur)
Validation des données
Protection contre les abus (rate limiting)

Planning

Le projet est organisé en plusieurs étapes :
Conception & cadrage
Développement frontend
Développement backend & données
Déploiement & tests

Équipe

Projet réalisé dans le cadre du titre RNCP Concepteur Développeur d’Applications (CDA).

Ce projet est développé en groupe de 3 personnes, avec une répartition des tâches (frontend, backend, gestion de projet) et une organisation basée sur Git et un board de suivi.
