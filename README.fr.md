# Clean My Agent

[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | [Français](README.fr.md)

![Clean My Agent hero](docs/assets/clean-my-agent-hero.png)

Clean My Agent est une application de bureau locale d’abord pour nettoyer, sauvegarder, exporter et comprendre les données de session des agents de codage IA.

Elle analyse les sessions locales de Codex, Claude Code, Cursor, Gemini et OpenCode, puis transforme les journaux dispersés en un tableau de bord clair pour le stockage, l’utilisation des tokens, les possibilités de nettoyage, les sauvegardes et les exports relay universels.

## Téléchargement

Installez la dernière version macOS Apple Silicon avec Homebrew :

```sh
brew tap blain3white/clean-my-agent
brew install --cask clean-my-agent
```

Mettez-la ensuite à jour avec :

```sh
brew upgrade --cask clean-my-agent
```

Ou téléchargez le dernier DMG depuis GitHub Releases :

[Télécharger Clean My Agent pour macOS](https://github.com/blain3white/clean-my-agent/releases/latest/download/Clean-My-Agent-mac-arm64.dmg)

Ouvrez le `.dmg` téléchargé, glissez Clean My Agent dans Applications, puis lancez-le depuis Applications.

La version de bureau actuelle n’est pas signée. Si macOS Gatekeeper bloque le premier lancement, ouvrez Réglages Système → Confidentialité et sécurité et autorisez Clean My Agent, ou faites un clic droit sur l’application et choisissez Ouvrir.

## Pourquoi

Les agents de codage IA créent beaucoup d’état local : conversations, journaux, métadonnées de projet, fichiers de cache, sauvegardes et traces d’outils. Ces données sont utiles, mais elles peuvent devenir difficiles à inspecter, déplacer ou nettoyer en toute sécurité.

Clean My Agent donne aux développeurs un seul endroit pour répondre à ces questions :

- Quels agents utilisent le plus d’espace disque ?
- Quelles sessions sont anormalement volumineuses ou anciennes ?
- Que peut-on nettoyer sans supprimer définitivement les fichiers ?
- Quelles sessions sont sauvegardées ?
- Combien d’activité token s’est accumulée entre les agents ?
- Une session peut-elle être exportée dans un format relay portable ?

## Fonctionnalités

- Analyser les sessions locales de Codex, Claude Code, Cursor, Gemini et OpenCode.
- Afficher le nombre de sessions, l’état des sauvegardes, l’espace récupérable, l’utilisation des tokens et la répartition du stockage.
- Rechercher et inspecter les sessions entre les agents pris en charge.
- Sauvegarder des sessions individuelles avant les actions de nettoyage risquées.
- Exporter les sessions en Markdown, JSON ou Universal Relay JSON.
- Détecter les anciennes sessions, les sessions sauvegardées, les grands journaux et les sauvegardes en double.
- Déplacer les candidats au nettoyage vers la corbeille gérée par l’application au lieu d’une suppression permanente.
- Restaurer des éléments depuis la corbeille.
- Exclure par défaut les fichiers ressemblant à des identifiants.
- Basculer l’interface entre l’anglais, le chinois, le japonais et le français.
- Prendre en charge les thèmes clair et sombre pour le tableau de bord.

## Modèle de sécurité

Clean My Agent est conçu pour être sûr par défaut.

- Il lit les données locales des agents avant d’écrire quoi que ce soit.
- Les suggestions de nettoyage sont générées d’abord et nécessitent une action explicite.
- Les candidats au nettoyage non sauvegardés sont sauvegardés avant d’être déplacés.
- Les fichiers supprimés vont dans la corbeille de Clean My Agent et peuvent être restaurés.
- Les tokens, clés API, données OAuth, fichiers `.env` et fichiers ressemblant à des identifiants sont ignorés par le scanner.
- Les comportements de nettoyage, sauvegarde, export et corbeille sont couverts par un test fonctionnel de fumée.

## Sources prises en charge

| Source      | État                                                |
| ----------- | --------------------------------------------------- |
| Codex       | Analyse, utilisation, sauvegarde, export, nettoyage |
| Claude Code | Analyse, utilisation, sauvegarde, export, nettoyage |
| Cursor      | Analyse, utilisation, sauvegarde, export, nettoyage |
| Gemini      | Analyse, utilisation, sauvegarde, export, nettoyage |
| OpenCode    | Analyse, utilisation, sauvegarde, export, nettoyage |

## Universal Relay JSON

L’export relay utilise un schéma intermédiaire stable :

```json
{
  "schema": "clean-my-agent.universal-session.v1",
  "source": "codex",
  "session": {},
  "messages": [],
  "files": [],
  "commands": [],
  "git": {},
  "attachments": [],
  "warnings": []
}
```

Ce format vise à faciliter l’archivage, l’inspection et, à terme, la conversion des données de session entre formats propres aux agents, sans coupler l’interface à la structure de stockage interne de chaque agent.

## Stack technique

- Electron
- React
- TypeScript
- Vite / electron-vite
- Tailwind CSS
- Radix / shadcn-style UI primitives
- Node.js 22.13 ou plus récent pour le développement
- Electron 42 avec Node.js 24.x à l’exécution desktop
- Node built-in SQLite
- pnpm

## Développement

Prérequis :

- Node.js 22.13.0 ou plus récent
- pnpm 10 ou plus récent

Installer les dépendances :

```bash
pnpm install
```

Démarrer l’application desktop :

```bash
pnpm dev
```

Démarrer le serveur de développement renderer uniquement :

```bash
pnpm dev:renderer
```

Construire :

```bash
pnpm build
```

Construire un DMG macOS Apple Silicon :

```bash
pnpm dist:mac
```

Lint :

```bash
pnpm lint
```

Lancer le test fonctionnel de fumée :

```bash
pnpm verify:functions
```

Le test de fumée crée temporairement de fausses données de session d’agents et vérifie l’analyse, les statistiques de tokens, la sauvegarde, l’export Markdown/JSON, l’export Universal Relay JSON, le nettoyage vers la corbeille et la restauration depuis la corbeille.

Lancer le gate CI local complet :

```bash
pnpm check
```

Les contributions partent généralement de `develop` et ouvrent des pull requests vers `develop`. Consultez [CONTRIBUTING.md](CONTRIBUTING.md) pour la configuration, le style, les tests, la sécurité et les consignes de pull request. Les recommandations de protection de branches côté mainteneur se trouvent dans [docs/maintainer-guide.md](docs/maintainer-guide.md).

## Carte du projet

- `electron/main.ts`: configuration de la fenêtre Electron et enregistrement IPC.
- `electron/preload.ts`: renderer-safe API bridge.
- `electron/lib/`: adaptateurs d’analyse, helpers de système de fichiers, base de données et logique app service.
- `src/App.tsx`: UI principale du tableau de bord et vues.
- `src/components/ui/`: primitives UI partagées.
- `src/hooks/`: état renderer et hooks de thème.
- `src/shared/types.ts`: types interprocessus et contrats partagés.
- `scripts/verify-functions.ts`: test fonctionnel de fumée avec de fausses données de session locales.

## Feuille de route

- Ajouter des vues de détail de session plus riches.
- Étendre les adaptateurs de stockage propres aux agents à mesure que les formats évoluent.
- Ajouter plus de convertisseurs relay au-dessus du schéma JSON universel.
- Améliorer les contrôles de politique de nettoyage pour les équipes ayant différentes préférences de conservation.
- Ajouter des builds desktop signés et notarized pour un premier lancement plus fluide.

## État

Ceci est une première version open source. L’application est utilisable pour l’analyse locale, les statistiques, la sauvegarde, l’export, les suggestions de nettoyage, la corbeille et l’export Universal Relay JSON. Les workflows d’import propres aux agents et de reprise de session ne sont volontairement pas encore finalisés.

## Licence

MIT
