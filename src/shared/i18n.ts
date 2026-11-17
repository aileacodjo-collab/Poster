import { Locale } from './types.ts';

export const LOCALE_META: Record<
  Locale,
  { code: Locale; nativeName: string; englishName: string; frenchName: string; hreflang: string | null }
> = {
  fr: {
    code: 'fr',
    nativeName: 'Français',
    englishName: 'French',
    frenchName: 'Français',
    hreflang: 'fr',
  },
  en: {
    code: 'en',
    nativeName: 'English',
    englishName: 'English',
    frenchName: 'Anglais',
    hreflang: 'en',
  },
  fon: {
    code: 'fon',
    nativeName: 'Fɔngbè',
    englishName: 'Fongbe',
    frenchName: 'Fongbe',
    hreflang: null, // Unsupported hreflang code intentionally omitted
  },
};

export interface UiDictionary {
  brandTagline: string;
  nav: {
    dashboard: string;
    posts: string;
    translations: string;
    reactions: string;
    seo: string;
    analytics: string;
    library: string;
    settings: string;
    publicSite: string;
  };
  auth: {
    signInTitle: string;
    signInSubtitle: string;
    signInButton: string;
    signOut: string;
    signedInAs: string;
    roleLabel: string;
    verifying: string;
  };
  common: {
    save: string;
    saving: string;
    saved: string;
    cancel: string;
    delete: string;
    confirmDelete: string;
    confirm: string;
    close: string;
    menu: string;
    refresh: string;
    create: string;
    import: string;
    export: string;
    publish: string;
    unpublish: string;
    preview: string;
    validate: string;
    restore: string;
    copyLink: string;
    copied: string;
    share: string;
    search: string;
    all: string;
    loading: string;
    empty: string;
    status: string;
    actions: string;
    back: string;
    untitled: string;
    none: string;
    charactersShort: string;
    words: string;
    kilobytes: string;
    loadError: string;
    saveError: string;
    deleteError: string;
    requestError: string;
  };
  statuses: {
    draft: string;
    validated: string;
    published: string;
    archived: string;
    missing: string;
    in_review: string;
    approved: string;
  };
  studio: {
    languageSelectorLabel: string;
    workspaceLabel: string;
    onboardingTitle: string;
    onboardingSubtitle: string;
    createPersonalWorkspace: string;
    joinWorkspaceTitle: string;
    workspaceIdPlaceholder: string;
    inviteTokenPlaceholder: string;
    acceptInvite: string;
    onboardingInitError: string;
    onboardingInviteError: string;
    editorialWorkspace: string;
    primaryNavAria: string;
  };
  dashboard: {
    title: string;
    subtitle: string;
    newPost: string;
    importMarkdown: string;
    totalPosts: string;
    publishedPosts: string;
    totalViews: string;
    totalReactions: string;
    recentEvents: string;
    translationMatrix: string;
    articleHeading: string;
  };
  postManager: {
    title: string;
    markdownEditor: string;
    livePreview: string;
    frontmatter: string;
    validationGate: string;
    versionHistory: string;
    slug: string;
    excerpt: string;
    category: string;
    featuredImage: string;
    autosaveActive: string;
    publishReady: string;
    publishBlocked: string;
    selectPost: string;
    newPostTitlePlaceholder: string;
    primaryLocaleLabel: string;
    loadMdFile: string;
    noImage: string;
    tagsLabel: string;
    noTags: string;
    titleLabel: string;
    versionLabel: string;
    restoredVersionNotice: string;
    pasteMdPlaceholder: string;
    importValidationError: string;
    deleteConfirmPrompt: string;
    versionPrefix: string;
  };
  translations: {
    title: string;
    subtitle: string;
    referenceLocale: string;
    targetLocale: string;
    fongbeReviewNotice: string;
    diacriticHelper: string;
    linguisticNotes: string;
    markInReview: string;
    approveTranslation: string;
    reviewerOnlyTooltip: string;
    linguisticNotesPlaceholder: string;
    markdownLabel: string;
  };
  reactions: {
    title: string;
    subtitle: string;
    presetsTitle: string;
    postMapTitle: string;
    semanticKey: string;
    emoji: string;
    limitPerVisitor: string;
    allowChange: string;
    enabled: string;
    addReaction: string;
    publicPrompt: string;
    yourReaction: string;
    changeAllowed: string;
    changeLocked: string;
    persistedVotes: string;
    moveUp: string;
    moveDown: string;
    saveAsPreset: string;
    presetSaved: string;
    presetDeleted: string;
    deletePresetConfirm: string;
    keyRequiredUnique: string;
    keyPlaceholder: string;
    labelFr: string;
    labelEn: string;
    labelFon: string;
    semanticKeyRequired: string;
    noPresets: string;
    noPostReactions: string;
  };
  seo: {
    title: string;
    subtitle: string;
    metaTitle: string;
    metaDescription: string;
    canonicalUrl: string;
    ogImage: string;
    hreflangNote: string;
    schemaPreview: string;
    sitemapInspect: string;
    robotsInspect: string;
    metadataHeading: string;
    noHreflangNote: string;
    serpPreviewHeading: string;
    hreflangHeading: string;
    noindexLabel: string;
  };
  analytics: {
    title: string;
    subtitle: string;
    views: string;
    uniqueVisitors: string;
    reactions: string;
    engagementRate: string;
    reactionChanges: string;
    languageBreakdown: string;
    referrers: string;
    noDataYet: string;
    postColumn: string;
    viewsShort: string;
    reactionsShort: string;
    noViewsYet: string;
    noReferrersYet: string;
  };
  library: {
    title: string;
    categories: string;
    tags: string;
    media: string;
    uploadImage: string;
    copyMarkdown: string;
    markdownCopied: string;
    invalidImageType: string;
    imageTooLarge: string;
    uploadSuccess: string;
    uploadError: string;
    deleteMediaConfirm: string;
    deleteTaxonomyConfirm: string;
    noMedia: string;
    noCategories: string;
    noTags: string;
  };
  settings: {
    title: string;
    workspace: string;
    teamRoles: string;
    backups: string;
    auditLogs: string;
    exportBackup: string;
    restoreBackup: string;
    brandNameLabel: string;
    workspaceNameLabel: string;
    workspaceSlugLabel: string;
    defaultLocaleLabel: string;
    publicUrlLabel: string;
    invalidUrlHint: string;
    inviteEmailPlaceholder: string;
    inviteCreated: string;
    inviteTokenOnceNotice: string;
    copyToken: string;
    inviteRevoked: string;
    joinedWorkspace: string;
    roleUpdated: string;
    revokedAction: string;
    invitationsTitle: string;
    joinAnotherTitle: string;
    auditDate: string;
    auditActor: string;
    auditAction: string;
    auditDetails: string;
    auditRestrictedNote: string;
    restoreSuccess: string;
    restoreInvalid: string;
    workspaceCol: string;
    tokenCol: string;
    noAuditLogs: string;
    confirmRemoveMember: string;
    confirmRevokeInvite: string;
    inviteButton: string;
    roleCol: string;
    memberCol: string;
  };
  publicReader: {
    allArticles: string;
    readArticle: string;
    readingTime: string;
    publishedOn: string;
    relatedArticles: string;
    noArticles: string;
    switchLanguage: string;
    studioLink: string;
    reactionRateLimitError: string;
    reactionSessionError: string;
  };
}

export const UI_STRINGS: Record<Locale, UiDictionary> = {
  fr: {
    brandTagline: 'Studio d’édition multilingue',
    nav: {
      dashboard: 'Tableau de bord',
      posts: 'Articles',
      translations: 'Traductions',
      reactions: 'Réactions',
      seo: 'Studio SEO',
      analytics: 'Analytique',
      library: 'Médiathèque',
      settings: 'Paramètres',
      publicSite: 'Page publique',
    },
    auth: {
      signInTitle: 'Connexion éditeur AILEA',
      signInSubtitle:
        'Connectez-vous avec Google pour gérer vos articles multilingues (français, anglais, fɔngbè), réactions sémantiques et pages SEO.',
      signInButton: 'Continuer avec Google',
      signOut: 'Déconnexion',
      signedInAs: 'Connecté',
      roleLabel: 'Rôle',
      verifying: 'Vérification de session…',
    },
    common: {
      save: 'Enregistrer',
      saving: 'Enregistrement…',
      saved: 'Enregistré',
      cancel: 'Annuler',
      delete: 'Supprimer',
      confirmDelete: 'Confirmer ?',
      confirm: 'Confirmer',
      close: 'Fermer',
      menu: 'Menu',
      refresh: 'Actualiser',
      create: 'Créer',
      import: 'Importer',
      export: 'Exporter',
      publish: 'Publier',
      unpublish: 'Dépublier',
      preview: 'Aperçu',
      validate: 'Valider',
      restore: 'Restaurer',
      copyLink: 'Copier le lien',
      copied: 'Lien copié',
      share: 'Partager',
      search: 'Rechercher…',
      all: 'Tous',
      loading: 'Chargement…',
      empty: 'Aucun élément',
      status: 'Statut',
      actions: 'Actions',
      back: 'Retour',
      untitled: 'Sans titre',
      none: 'Aucune',
      charactersShort: 'car.',
      words: 'mots',
      kilobytes: 'Ko',
      loadError: 'Impossible de charger les données.',
      saveError: 'Erreur lors de l’enregistrement.',
      deleteError: 'Erreur lors de la suppression.',
      requestError: 'La requête a échoué.',
    },
    statuses: {
      draft: 'Brouillon',
      validated: 'Validé',
      published: 'Publié',
      archived: 'Archivé',
      missing: 'Manquant',
      in_review: 'En révision',
      approved: 'Approuvé',
    },
    studio: {
      languageSelectorLabel: 'Langue',
      workspaceLabel: 'Espace',
      onboardingTitle: 'Bienvenue dans AILEA PostManager',
      onboardingSubtitle:
        'Votre compte est vérifié mais n’appartient encore à aucun espace éditorial. Créez votre propre espace ou rejoignez une équipe via un jeton d’invitation.',
      createPersonalWorkspace: 'Créer mon espace éditorial',
      joinWorkspaceTitle: 'Rejoindre un espace existant',
      workspaceIdPlaceholder: 'ID de l’espace (ex: ws_...)',
      inviteTokenPlaceholder: 'Jeton d’invitation secret',
      acceptInvite: 'Accepter l’invitation',
      onboardingInitError: 'Impossible d’initialiser votre espace éditorial.',
      onboardingInviteError: 'Invitation invalide ou expirée.',
      editorialWorkspace: 'Espace éditorial',
      primaryNavAria: 'Navigation principale',
    },
    dashboard: {
      title: 'Vue d’ensemble éditoriale',
      subtitle: 'Suivez l’avancement des traductions, la validation et l’engagement réel.',
      newPost: 'Nouvel article',
      importMarkdown: 'Importer Markdown',
      totalPosts: 'Articles',
      publishedPosts: 'Publiés',
      totalViews: 'Vues réelles',
      totalReactions: 'Réactions réelles',
      recentEvents: 'Journal de publication',
      translationMatrix: 'Matrice de traduction',
      articleHeading: 'Article',
    },
    postManager: {
      title: 'Gestionnaire d’articles',
      markdownEditor: 'Éditeur Markdown',
      livePreview: 'Aperçu sécurisé',
      frontmatter: 'En-tête YAML',
      validationGate: 'Validation avant publication',
      versionHistory: 'Historique des versions',
      slug: 'Slug permanent',
      excerpt: 'Extrait éditorial',
      category: 'Catégorie',
      featuredImage: 'Image de couverture',
      autosaveActive: 'Sauvegarde auto active',
      publishReady: 'Prêt pour publication',
      publishBlocked: 'Publication bloquée — corrigez les erreurs',
      selectPost: 'Sélectionnez ou créez un article pour commencer.',
      newPostTitlePlaceholder: 'Titre de l’article…',
      primaryLocaleLabel: 'Langue principale',
      loadMdFile: 'Charger un fichier .md',
      noImage: 'Aucune image',
      tagsLabel: 'Étiquettes',
      noTags: 'Aucune étiquette dans la médiathèque.',
      titleLabel: 'Titre',
      versionLabel: 'Version',
      restoredVersionNotice: 'Version v{version} restaurée comme nouveau brouillon.',
      pasteMdPlaceholder: '---\ntitle: Mon titre\nslug: mon-titre\nlocale: fr\n---\n\nVotre contenu Markdown…',
      importValidationError: 'Le contenu Markdown et la langue sont requis.',
      deleteConfirmPrompt: 'Confirmer la suppression ?',
      versionPrefix: 'Version',
    },
    translations: {
      title: 'Studio de traduction',
      subtitle: 'Édition indépendante et révision linguistique pour Français, Anglais et Fɔngbè.',
      referenceLocale: 'Langue de référence',
      targetLocale: 'Langue cible',
      fongbeReviewNotice:
        'Révision linguistique humaine requise : ne publiez jamais de contenu fɔngbè sans relecture orthographique et tonale.',
      diacriticHelper: 'Clavier Fɔngbè & tons Unicode',
      linguisticNotes: 'Notes linguistiques & tonales',
      markInReview: 'Soumettre pour révision',
      approveTranslation: 'Approuver la traduction',
      reviewerOnlyTooltip: 'Réservé aux réviseurs ou propriétaires pour le fɔngbè',
      linguisticNotesPlaceholder: 'Notes orthographiques, variantes tonales ou remarques de révision…',
      markdownLabel: 'Contenu Markdown',
    },
    reactions: {
      title: 'Studio des réactions',
      subtitle: 'Définissez des clés sémantiques universelles et des libellés localisés.',
      presetsTitle: 'Modèles de l’espace',
      postMapTitle: 'Réactions de l’article',
      semanticKey: 'Clé sémantique',
      emoji: 'Emoji',
      limitPerVisitor: 'Limite par visiteur',
      allowChange: 'Autoriser le changement d’avis',
      enabled: 'Activée',
      addReaction: 'Ajouter une réaction',
      publicPrompt: 'Quelle émotion suscite cette lecture ?',
      yourReaction: 'Votre réaction',
      changeAllowed: 'Vous pouvez modifier votre choix à tout moment.',
      changeLocked: 'Choix définitif après envoi.',
      persistedVotes: 'votes persistés',
      moveUp: 'Monter',
      moveDown: 'Descendre',
      saveAsPreset: 'Modèle',
      presetSaved: 'Modèle enregistré dans l’espace.',
      presetDeleted: 'Modèle supprimé.',
      deletePresetConfirm: 'Supprimer ce modèle ?',
      keyRequiredUnique: 'Clé sémantique requise et unique (a-z, 0-9, _).',
      keyPlaceholder: 'ex: solidarity',
      labelFr: 'Libellé FR',
      labelEn: 'Libellé EN',
      labelFon: 'Libellé Fɔngbè',
      semanticKeyRequired: 'Clé sémantique requise.',
      noPresets: 'Aucun modèle enregistré dans cet espace.',
      noPostReactions: 'Aucune réaction configurée pour cet article.',
    },
    seo: {
      title: 'Studio SEO & Indexation',
      subtitle: 'Métadonnées localisées, balises hreflang réciproques (FR/EN) et données structurées.',
      metaTitle: 'Titre SEO',
      metaDescription: 'Méta-description',
      canonicalUrl: 'URL canonique',
      ogImage: 'Image Open Graph',
      hreflangNote:
        'Seules les variantes FR et EN génèrent des balises hreflang réciproques. Le code fɔngbè est exclu des balises hreflang non standard.',
      schemaPreview: 'Aperçu JSON-LD Schema.org',
      sitemapInspect: 'Sitemap XML en direct',
      robotsInspect: 'Directives robots.txt',
      metadataHeading: 'Métadonnées',
      noHreflangNote: 'Fɔngbè : aucune balise hreflang générée (évite les codes non standard).',
      serpPreviewHeading: 'Aperçu moteur de recherche (SERP)',
      hreflangHeading: 'Balises hreflang (FR / EN uniquement)',
      noindexLabel: 'Désactiver l’indexation (noindex, nofollow)',
    },
    analytics: {
      title: 'Analytique d’engagement',
      subtitle: 'Mesures authentiques calculées côté serveur sans traçage personnel.',
      views: 'Vues de pages',
      uniqueVisitors: 'Visiteurs uniques',
      reactions: 'Réactions enregistrées',
      engagementRate: 'Taux d’engagement',
      reactionChanges: 'Changements d’avis',
      languageBreakdown: 'Répartition par langue',
      referrers: 'Sources de trafic',
      noDataYet: 'Aucune interaction enregistrée pour le moment.',
      postColumn: 'Article',
      viewsShort: 'vues',
      reactionsShort: 'réactions',
      noViewsYet: 'Aucune vue enregistrée',
      noReferrersYet: 'Aucune source enregistrée',
    },
    library: {
      title: 'Bibliothèque de contenu',
      categories: 'Catégories',
      tags: 'Étiquettes',
      media: 'Médias validés',
      uploadImage: 'Téléverser une image',
      copyMarkdown: 'Copier Markdown',
      markdownCopied: 'Balise image Markdown copiée.',
      invalidImageType: 'Format d’image non pris en charge (PNG, JPEG, WebP ou GIF uniquement).',
      imageTooLarge: 'Image trop volumineuse (maximum 5 Mo).',
      uploadSuccess: 'Média ajouté et validé.',
      uploadError: 'Erreur lors de l’envoi du média.',
      deleteMediaConfirm: 'Supprimer ce média ?',
      deleteTaxonomyConfirm: 'Supprimer ?',
      noMedia: 'Aucun média dans cet espace.',
      noCategories: 'Aucune catégorie créée.',
      noTags: 'Aucune étiquette créée.',
    },
    settings: {
      title: 'Paramètres de l’espace',
      workspace: 'Identité éditoriale',
      teamRoles: 'Équipe & Rôles RBAC',
      backups: 'Sauvegardes & Restauration',
      auditLogs: 'Journal d’audit sécurité',
      exportBackup: 'Exporter sauvegarde JSON',
      restoreBackup: 'Restaurer depuis JSON',
      brandNameLabel: 'Nom public de la revue (brandName)',
      workspaceNameLabel: 'Nom interne de l’espace',
      workspaceSlugLabel: 'Slug de l’espace',
      defaultLocaleLabel: 'Langue par défaut',
      publicUrlLabel: 'URL de base publique',
      invalidUrlHint: 'Doit être une URL http(s) valide ou vide.',
      inviteEmailPlaceholder: 'collegue@domaine.org',
      inviteCreated: 'Invitation créée pour',
      inviteTokenOnceNotice: 'Copiez ce jeton maintenant : il ne sera plus affiché après rafraîchissement.',
      copyToken: 'Copier le jeton',
      inviteRevoked: 'Invitation révoquée.',
      joinedWorkspace: 'Vous avez rejoint l’espace éditorial.',
      roleUpdated: 'Rôle mis à jour.',
      revokedAction: 'Accès révoqué.',
      invitationsTitle: 'Invitations en attente & historique',
      joinAnotherTitle: 'Rejoindre un autre espace via invitation',
      auditDate: 'Date',
      auditActor: 'Acteur',
      auditAction: 'Action',
      auditDetails: 'Détails',
      auditRestrictedNote: 'Le journal d’audit sécurité complet est réservé aux propriétaires et éditeurs.',
      restoreSuccess: 'Sauvegarde restaurée ({count} documents).',
      restoreInvalid: 'Fichier JSON invalide ou corrompu.',
      workspaceCol: 'ID Espace',
      tokenCol: 'Jeton',
      noAuditLogs: 'Aucun événement d’audit enregistré.',
      confirmRemoveMember: 'Retirer ce membre ?',
      confirmRevokeInvite: 'Révoquer cette invitation ?',
      inviteButton: 'Inviter',
      roleCol: 'Rôle',
      memberCol: 'Membre',
    },
    publicReader: {
      allArticles: 'Toutes les publications',
      readArticle: 'Lire l’article',
      readingTime: 'min de lecture',
      publishedOn: 'Publié le',
      relatedArticles: 'À lire également',
      noArticles: 'Aucun article publié dans cette langue pour le moment.',
      switchLanguage: 'Langue',
      studioLink: 'Studio AILEA',
      reactionRateLimitError: 'Trop de réactions envoyées. Patientez un instant.',
      reactionSessionError: 'Session visiteur requise. Rechargez la page puis réessayez.',
    },
  },
  en: {
    brandTagline: 'Multilingual Publishing Studio',
    nav: {
      dashboard: 'Dashboard',
      posts: 'Posts',
      translations: 'Translations',
      reactions: 'Reactions',
      seo: 'SEO Studio',
      analytics: 'Analytics',
      library: 'Library',
      settings: 'Settings',
      publicSite: 'Public Page',
    },
    auth: {
      signInTitle: 'AILEA Publisher Sign In',
      signInSubtitle:
        'Sign in with Google to manage multilingual Markdown articles (French, English, Fongbe), semantic reactions, and SEO.',
      signInButton: 'Continue with Google',
      signOut: 'Sign Out',
      signedInAs: 'Signed in',
      roleLabel: 'Role',
      verifying: 'Verifying session…',
    },
    common: {
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      cancel: 'Cancel',
      delete: 'Delete',
      confirmDelete: 'Confirm?',
      confirm: 'Confirm',
      close: 'Close',
      menu: 'Menu',
      refresh: 'Refresh',
      create: 'Create',
      import: 'Import',
      export: 'Export',
      publish: 'Publish',
      unpublish: 'Unpublish',
      preview: 'Preview',
      validate: 'Validate',
      restore: 'Restore',
      copyLink: 'Copy link',
      copied: 'Link copied',
      share: 'Share',
      search: 'Search…',
      all: 'All',
      loading: 'Loading…',
      empty: 'No items yet',
      status: 'Status',
      actions: 'Actions',
      back: 'Back',
      untitled: 'Untitled',
      none: 'None',
      charactersShort: 'chars',
      words: 'words',
      kilobytes: 'KB',
      loadError: 'Unable to load data.',
      saveError: 'Failed to save changes.',
      deleteError: 'Failed to delete item.',
      requestError: 'The request failed.',
    },
    statuses: {
      draft: 'Draft',
      validated: 'Validated',
      published: 'Published',
      archived: 'Archived',
      missing: 'Missing',
      in_review: 'In Review',
      approved: 'Approved',
    },
    studio: {
      languageSelectorLabel: 'Language',
      workspaceLabel: 'Workspace',
      onboardingTitle: 'Welcome to AILEA PostManager',
      onboardingSubtitle:
        'Your account is verified, but you are not a member of an editorial workspace yet. Create a personal workspace or join a team with an invite token.',
      createPersonalWorkspace: 'Create my editorial workspace',
      joinWorkspaceTitle: 'Join an existing workspace',
      workspaceIdPlaceholder: 'Workspace ID (e.g. ws_...)',
      inviteTokenPlaceholder: 'Secret invite token',
      acceptInvite: 'Accept invite',
      onboardingInitError: 'Unable to initialize your editorial workspace.',
      onboardingInviteError: 'Invalid or expired invite.',
      editorialWorkspace: 'Editorial workspace',
      primaryNavAria: 'Primary navigation',
    },
    dashboard: {
      title: 'Editorial Overview',
      subtitle: 'Track translation readiness, validation gates, and authentic reader engagement.',
      newPost: 'New Post',
      importMarkdown: 'Import Markdown',
      totalPosts: 'Total Posts',
      publishedPosts: 'Published',
      totalViews: 'Recorded Views',
      totalReactions: 'Recorded Reactions',
      recentEvents: 'Publishing Events',
      translationMatrix: 'Translation Readiness',
      articleHeading: 'Article',
    },
    postManager: {
      title: 'Post Manager',
      markdownEditor: 'Markdown Editor',
      livePreview: 'Sanitized Preview',
      frontmatter: 'YAML Frontmatter',
      validationGate: 'Publication Validation',
      versionHistory: 'Version History',
      slug: 'Permanent Slug',
      excerpt: 'Editorial Excerpt',
      category: 'Category',
      featuredImage: 'Cover Image',
      autosaveActive: 'Autosave ready',
      publishReady: 'Ready to publish',
      publishBlocked: 'Publishing blocked — resolve errors',
      selectPost: 'Select or create a post to begin.',
      newPostTitlePlaceholder: 'Article title…',
      primaryLocaleLabel: 'Primary language',
      loadMdFile: 'Load .md file',
      noImage: 'No image',
      tagsLabel: 'Tags',
      noTags: 'No tags created in the content library yet.',
      titleLabel: 'Title',
      versionLabel: 'Version',
      restoredVersionNotice: 'Version v{version} restored as a new draft.',
      pasteMdPlaceholder: '---\ntitle: My Title\nslug: my-title\nlocale: en\n---\n\nYour Markdown body…',
      importValidationError: 'Markdown content and target language are required.',
      deleteConfirmPrompt: 'Confirm deletion?',
      versionPrefix: 'Version',
    },
    translations: {
      title: 'Translation Studio',
      subtitle: 'Independent authoring and linguistic review across French, English, and Fongbe.',
      referenceLocale: 'Reference Language',
      targetLocale: 'Target Language',
      fongbeReviewNotice:
        'Human linguistic review required: never publish Fongbe content without orthographic and tonal verification.',
      diacriticHelper: 'Fongbe & Unicode Tone Bar',
      linguisticNotes: 'Linguistic & Tonal Notes',
      markInReview: 'Submit for Review',
      approveTranslation: 'Approve Translation',
      reviewerOnlyTooltip: 'Restricted to reviewers or owners for Fongbe',
      linguisticNotesPlaceholder: 'Orthographic notes, tone markings, or review feedback…',
      markdownLabel: 'Markdown content',
    },
    reactions: {
      title: 'Reaction Studio',
      subtitle: 'Configure semantic reaction keys and localized labels across languages.',
      presetsTitle: 'Workspace Presets',
      postMapTitle: 'Post Reaction Map',
      semanticKey: 'Semantic Key',
      emoji: 'Emoji',
      limitPerVisitor: 'Limit per Visitor',
      allowChange: 'Allow visitors to change reaction',
      enabled: 'Enabled',
      addReaction: 'Add Reaction',
      publicPrompt: 'How did this story resonate with you?',
      yourReaction: 'Your reaction',
      changeAllowed: 'You may update your reaction at any time.',
      changeLocked: 'Selection is final once submitted.',
      persistedVotes: 'persisted votes',
      moveUp: 'Move up',
      moveDown: 'Move down',
      saveAsPreset: 'Preset',
      presetSaved: 'Saved as workspace preset.',
      presetDeleted: 'Preset deleted.',
      deletePresetConfirm: 'Delete this preset?',
      keyRequiredUnique: 'Semantic key must be unique (a-z, 0-9, _).',
      keyPlaceholder: 'e.g. solidarity',
      labelFr: 'Label FR',
      labelEn: 'Label EN',
      labelFon: 'Label Fɔngbè',
      semanticKeyRequired: 'Semantic key is required.',
      noPresets: 'No presets saved in this workspace yet.',
      noPostReactions: 'No reactions configured on this article.',
    },
    seo: {
      title: 'SEO Studio',
      subtitle: 'Localized metadata, reciprocal FR/EN hreflang annotations, and structured data.',
      metaTitle: 'SEO Title',
      metaDescription: 'Meta Description',
      canonicalUrl: 'Canonical URL',
      ogImage: 'Open Graph Image',
      hreflangNote:
        'Only French and English emit reciprocal hreflang tags. Fongbe URLs remain indexable without unsupported hreflang codes.',
      schemaPreview: 'Schema.org JSON-LD Preview',
      sitemapInspect: 'Live XML Sitemap',
      robotsInspect: 'Robots Directives',
      metadataHeading: 'Metadata',
      noHreflangNote: 'Fongbe: no hreflang tags emitted (avoids non-standard codes).',
      serpPreviewHeading: 'Search Engine Snippet (SERP)',
      hreflangHeading: 'Hreflang tags (FR / EN only)',
      noindexLabel: 'Disable indexing (noindex, nofollow)',
    },
    analytics: {
      title: 'Engagement Analytics',
      subtitle: 'Server-verified page views and reactions using privacy-conscious hashes.',
      views: 'Page Views',
      uniqueVisitors: 'Unique Visitors',
      reactions: 'Total Reactions',
      engagementRate: 'Engagement Rate',
      reactionChanges: 'Reaction Changes',
      languageBreakdown: 'Language Distribution',
      referrers: 'Referral Sources',
      noDataYet: 'No reader interactions recorded yet.',
      postColumn: 'Post',
      viewsShort: 'views',
      reactionsShort: 'reactions',
      noViewsYet: 'No views recorded',
      noReferrersYet: 'No referrers recorded',
    },
    library: {
      title: 'Content Library',
      categories: 'Categories',
      tags: 'Tags',
      media: 'Media Assets',
      uploadImage: 'Upload Image',
      copyMarkdown: 'Copy Markdown',
      markdownCopied: 'Markdown image snippet copied.',
      invalidImageType: 'Unsupported image format (PNG, JPEG, WebP, or GIF only).',
      imageTooLarge: 'Image is too large (5 MB max).',
      uploadSuccess: 'Media uploaded and validated.',
      uploadError: 'Failed to upload media.',
      deleteMediaConfirm: 'Delete this media asset?',
      deleteTaxonomyConfirm: 'Delete?',
      noMedia: 'No media assets uploaded in this workspace.',
      noCategories: 'No categories created yet.',
      noTags: 'No tags created yet.',
    },
    settings: {
      title: 'Workspace Settings',
      workspace: 'Editorial Identity',
      teamRoles: 'Team & RBAC Roles',
      backups: 'Backups & Restore',
      auditLogs: 'Security Audit Logs',
      exportBackup: 'Export JSON Backup',
      restoreBackup: 'Restore from JSON',
      brandNameLabel: 'Public publication name (brandName)',
      workspaceNameLabel: 'Internal workspace name',
      workspaceSlugLabel: 'Workspace slug',
      defaultLocaleLabel: 'Default language',
      publicUrlLabel: 'Public base URL',
      invalidUrlHint: 'Must be a valid http(s) URL or blank.',
      inviteEmailPlaceholder: 'colleague@domain.org',
      inviteCreated: 'Invitation created for',
      inviteTokenOnceNotice: 'Copy this token now: it will not be shown again after reload.',
      copyToken: 'Copy token',
      inviteRevoked: 'Invite revoked.',
      joinedWorkspace: 'Joined editorial workspace.',
      roleUpdated: 'Role updated.',
      revokedAction: 'Access revoked.',
      invitationsTitle: 'Pending & past invitations',
      joinAnotherTitle: 'Join another workspace via invite',
      auditDate: 'Date',
      auditActor: 'Actor',
      auditAction: 'Action',
      auditDetails: 'Details',
      auditRestrictedNote: 'Full security audit logs are restricted to owners and editors.',
      restoreSuccess: 'Backup restored ({count} documents).',
      restoreInvalid: 'Invalid or corrupted JSON backup file.',
      workspaceCol: 'Workspace ID',
      tokenCol: 'Token',
      noAuditLogs: 'No audit log entries recorded yet.',
      confirmRemoveMember: 'Remove member?',
      confirmRevokeInvite: 'Revoke invite?',
      inviteButton: 'Invite',
      roleCol: 'Role',
      memberCol: 'Member',
    },
    publicReader: {
      allArticles: 'All Publications',
      readArticle: 'Read article',
      readingTime: 'min read',
      publishedOn: 'Published on',
      relatedArticles: 'Related reading',
      noArticles: 'No published articles in this language yet.',
      switchLanguage: 'Language',
      studioLink: 'AILEA Studio',
      reactionRateLimitError: 'Too many reactions sent. Please wait a moment.',
      reactionSessionError: 'Visitor session required. Reload the page and try again.',
    },
  },
  fon: {
    brandTagline: 'Xógbè gègè wěmá wlǎn-tɛ́n',
    nav: {
      dashboard: 'Bǐbɛ́mɛ tɛ́n',
      posts: 'Xówlǎn lɛ́',
      translations: 'Gbè-lílɛ́',
      reactions: 'Xó-sín-nú',
      seo: 'SEO Tɛ́n',
      analytics: 'Nǔ-kpɔ́n-tɛ́n',
      library: 'Wěmá-xɔ',
      settings: 'Tòtò-tɛ́n',
      publicSite: 'Tò-bǐ tɛ́n',
    },
    auth: {
      signInTitle: 'Byɔ́ AILEA mɛ',
      signInSubtitle:
        'Zǎn Google bó ná kpé nǔkún dó xówlǎn Flanségbè, Glɛ̌sìgbè kpódó Fɔngbè kpán wú.',
      signInButton: 'Zǎn Google bó byɔ́ mɛ',
      signOut: 'Tɔ́n sín mɛ',
      signedInAs: 'A ɖò mɛ',
      roleLabel: 'Azɔ̌',
      verifying: 'Mí ɖò kpɔ́nwɛ́…',
    },
    common: {
      save: 'Hɛn ɖó',
      saving: 'É ɖò hɛnhɛn wɛ…',
      saved: 'É hɛn ɖó',
      cancel: 'Gblé',
      delete: 'Súnsún',
      confirmDelete: 'Hɛn nǔgbó?',
      confirm: 'Yí gbè',
      close: 'Sú',
      menu: 'Alɔnu-tɛ́n',
      refresh: 'Lɛ́ jlá',
      create: 'Bló yɔ̌yɔ́',
      import: 'Sɔ́ byɔ́ mɛ',
      export: 'Ðè tɔ́n',
      publish: 'Ðè xó tɔ́n',
      unpublish: 'Sɔ́ xó hwla',
      preview: 'Kpɔ́n hwɛ̌',
      validate: 'Kpɔ́n ɖɔ é sɔ́gbè',
      restore: 'Lɛ́ kɔ wá',
      copyLink: 'Wlí alɔ-kán',
      copied: 'Wlí alɔ-kán fó',
      share: 'Má',
      search: 'Ba…',
      all: 'Bǐ',
      loading: 'É ɖò wíwá wɛ…',
      empty: 'Nǔ ɖě ɖò fí ǎ',
      status: 'Nìnɔmɛ',
      actions: 'Azɔ̌ lɛ́',
      back: 'Lɛ́ kɔ',
      untitled: 'Xótà ɖě ǎ',
      none: 'Ðě ǎ',
      charactersShort: 'wěkwín',
      words: 'xókwin',
      kilobytes: 'Ko',
      loadError: 'È sìxú bɛ́ nǔ lɛ́ wá ǎ.',
      saveError: 'Nǔ ɖě jɛ̀ ɖò hɛnhɛn mɛ.',
      deleteError: 'È sìxú súnsún ǎ.',
      requestError: 'Azɔ̌ lɛ́ gló.',
    },
    statuses: {
      draft: 'Wěmá kpɛví',
      validated: 'É sɔ́gbè',
      published: 'É tɔ́n',
      archived: 'É hwlá',
      missing: 'É ɖò fí ǎ',
      in_review: 'É ɖò kpɔ́nwɛ́',
      approved: 'É yí gbè',
    },
    studio: {
      languageSelectorLabel: 'Gbè',
      workspaceLabel: 'Azɔ̌tɛ́n',
      onboardingTitle: 'Kwabɔ́ ɖò AILEA PostManager',
      onboardingSubtitle:
        'A ɖò azɔ̌tɛ́n ɖébǔ mɛ có ǎ. Bló azɔ̌tɛ́n towe yɔ̌yɔ́ alǒ zǎn gbe-kán bó byɔ́ gbɛ̌ta ɖé mɛ.',
      createPersonalWorkspace: 'Bló azɔ̌tɛ́n ce',
      joinWorkspaceTitle: 'Byɔ́ azɔ̌tɛ́n ɖěvó mɛ',
      workspaceIdPlaceholder: 'Azɔ̌tɛ́n sín ID (ws_...)',
      inviteTokenPlaceholder: 'Gbe-kán hwlahwla',
      acceptInvite: 'Yí gbè-byɔ́',
      onboardingInitError: 'È sìxú bló azɔ̌tɛ́n yɔ̌yɔ́ ǎ.',
      onboardingInviteError: 'Gbe-byɔ́ élɔ́ sɔ́gbè ǎ alǒ é gblé.',
      editorialWorkspace: 'Azɔ̌tɛ́n wlǎnwá',
      primaryNavAria: 'Ali nukɔntɔn',
    },
    dashboard: {
      title: 'Azɔ̌ bǐ sín kpɔ́nwɛ́',
      subtitle: 'Kpɔ́n gbè-lílɛ́ lɛ́ kpódó mɛ lɛ́ sín xó-sín-nú nǔgbó kpán.',
      newPost: 'Wlǎn xó yɔ̌yɔ́',
      importMarkdown: 'Sɔ́ Markdown byɔ́',
      totalPosts: 'Xówlǎn bǐ',
      publishedPosts: 'É tɔ́n lɛ́',
      totalViews: 'Mɛ e xà lɛ́',
      totalReactions: 'Xó-sín-nú lɛ́',
      recentEvents: 'Xó-ɖíɖè gǔdo tɔn',
      translationMatrix: 'Gbè-lílɛ́ sín tɛ́n',
      articleHeading: 'Xówlǎn',
    },
    postManager: {
      title: 'Xówlǎn kpékpé-tɛ́n',
      markdownEditor: 'Markdown wlǎn-tɛ́n',
      livePreview: 'Kpɔ́n ɖò alɔ jí',
      frontmatter: 'YAML bǐbɛ́mɛ',
      validationGate: 'Kpɔ́n-ɖó-tòtò cóbónú è nǎ ɖè tɔ́n',
      versionHistory: 'Xówlǎn xóxó lɛ́',
      slug: 'Alɔ-kán tɛgbɛ',
      excerpt: 'Xó kléwun',
      category: 'Akɔ́ta',
      featuredImage: 'Fɔtóo nukɔntɔn',
      autosaveActive: 'É nɔ́ hɛn ɖó éɖésú',
      publishReady: 'É sɔ́gbè nú ɖíɖè tɔ́n',
      publishBlocked: 'È sìxú ɖè tɔ́n ǎ — bló nǔ e jɛ̀ ǎ lɛ́ ɖó',
      selectPost: 'Cyán xówlǎn ɖé alǒ bló yɔ̌yɔ́.',
      newPostTitlePlaceholder: 'Xótà xówlǎn tɔn…',
      primaryLocaleLabel: 'Gbè nukɔntɔn',
      loadMdFile: 'Zé wěmá .md ɖó',
      noImage: 'Fɔtóo ɖě ǎ',
      tagsLabel: 'Wuntun lɛ́',
      noTags: 'Wuntun ɖě ɖò wěmá-xɔ mɛ có ǎ.',
      titleLabel: 'Xótà',
      versionLabel: 'Wěmá-kɛ́n',
      restoredVersionNotice: 'Xówlǎn v{version} lɛ́ kɔ wá ɖó kpɛví mɛ.',
      pasteMdPlaceholder: '---\ntitle: Xótà ce\nslug: xota-ce\nlocale: fon\n---\n\nWlǎn xó towe dó fí…',
      importValidationError: 'Markdown kpódó gbè kpán ɖò dò.',
      deleteConfirmPrompt: 'Hɛn nǔgbó ɖɔ a ná súnsún?',
      versionPrefix: 'Wěmá-kɛ́n',
    },
    translations: {
      title: 'Gbè-lílɛ́ sín tɛ́n',
      subtitle: 'Wlǎn Flanségbè, Glɛ̌sìgbè kpódó Fɔngbè kpán vòvò.',
      referenceLocale: 'Gbè nukɔntɔn',
      targetLocale: 'Gbè e jɛ̀ gǔdo',
      fongbeReviewNotice:
        'Gbɛtɔ́ sín kpɔ́nwɛ́ ɖò tàjí: mà ɖè Fɔngbè tɔ́n má kpɔ́n wěkwín kpódó gbè-ɖyɔ́ lɛ́ kpán ó.',
      diacriticHelper: 'Wěkwín Fɔngbè tɔn lɛ́',
      linguisticNotes: 'Gbè sín tɛ́n-mɛ-xó',
      markInReview: 'Sɛ́ dó kpɔ́nwɛ́',
      approveTranslation: 'Yí gbè nú gbè-lílɛ́',
      reviewerOnlyTooltip: 'Mɛ e nɔ́ kpɔ́n gbè kpódó gǎn kpán kɛ́ɖɛ́ wɛ síxú yí gbè nú Fɔngbè',
      linguisticNotesPlaceholder: 'Wěkwín sín tɛ́n-mɛ-xó, gbè-ɖyɔ́ lɛ́ alǒ kpɔ́nwɛ́-xó…',
      markdownLabel: 'Wěmá Markdown',
    },
    reactions: {
      title: 'Xó-sín-nú tɛ́n',
      subtitle: 'Tò xó-sín-nú lɛ́ kpódó nyǐkɔ yětɔn ɖò gbè bǐ mɛ.',
      presetsTitle: 'Kpɔ́ndéwú lɛ́',
      postMapTitle: 'Xó-sín-nú xówlǎn élɔ́ tɔn',
      semanticKey: 'Tinmɛ sín xó',
      emoji: 'Wuntun',
      limitPerVisitor: 'Nǔbǐ nú mɛ ɖokpó',
      allowChange: 'Jǒ mɛ dó nú é ná ɖyɔ́ linlin',
      enabled: 'É ɖò azɔ̌ wà wɛ',
      addReaction: 'Gɔ́ xó-sín-nú ɖokpó',
      publicPrompt: 'Nɛ̌ xó élɔ́ ka cí nú we?',
      yourReaction: 'Xó-sín-nú towe',
      changeAllowed: 'A sìxú ɖyɔ́ linlin towe hweɖébǔnu.',
      changeLocked: 'É sɔ́ jɛ̀ ɖíɖyɔ́ ǎ.',
      persistedVotes: 'yígbè e hɛn ɖó lɛ́',
      moveUp: 'Sɛ́ yì jǐ',
      moveDown: 'Sɛ́ wá dò',
      saveAsPreset: 'Kpɔ́ndéwú',
      presetSaved: 'Kpɔ́ndéwú hɛn ɖó azɔ̌tɛ́n mɛ.',
      presetDeleted: 'Kpɔ́ndéwú súnsún.',
      deletePresetConfirm: 'Súnsún kpɔ́ndéwú élɔ́?',
      keyRequiredUnique: 'Tinmɛ sín xó ɖó ná nyí vòvò (a-z, 0-9, _).',
      keyPlaceholder: 'kpɔ́ndéwú: solidarity',
      labelFr: 'Nyǐkɔ FR',
      labelEn: 'Nyǐkɔ EN',
      labelFon: 'Nyǐkɔ Fɔngbè',
      semanticKeyRequired: 'Tinmɛ sín xó ɖò dò.',
      noPresets: 'Kpɔ́ndéwú ɖě ɖò azɔ̌tɛ́n élɔ́ mɛ có ǎ.',
      noPostReactions: 'Xó-sín-nú ɖě ɖò xówlǎn élɔ́ jí ǎ.',
    },
    seo: {
      title: 'SEO Tɛ́n',
      subtitle: 'Nyǐkɔ gànjí, hreflang FR/EN kpódó Schema.org kpán.',
      metaTitle: 'Xótà SEO',
      metaDescription: 'Tinmɛ kléwun SEO',
      canonicalUrl: 'Alɔ-kán jɔwɛ',
      ogImage: 'Fɔtóo má-tɔn',
      hreflangNote:
        'Flanségbè kpódó Glɛ̌sìgbè kpán kɛ́ɖɛ́ wɛ nɔ́ zán hreflang. Fɔngbè nɔ́ zán hreflang ǎ.',
      schemaPreview: 'Schema.org JSON-LD',
      sitemapInspect: 'Sitemap XML',
      robotsInspect: 'Robots.txt',
      metadataHeading: 'Nyǐkɔ SEO tɔn lɛ́',
      noHreflangNote: 'Fɔngbè: hreflang ɖě nɔ́ tɔ́n ǎ.',
      serpPreviewHeading: 'Kpɔ́ndéwú ɖò mɔ-ba-tɛ́n (SERP)',
      hreflangHeading: 'Hreflang (FR / EN kɛ́ɖɛ́)',
      noindexLabel: 'Mà jǒ mɔ-ba-tɛ́n dó ó (noindex, nofollow)',
    },
    analytics: {
      title: 'Nǔ-kpɔ́n-tɛ́n',
      subtitle: 'Kɛ́n nǔgbó e gòsín mɛ lɛ́ gɔ́n, má hɛn nyǐkɔ mɛ tɔn bú ó.',
      views: 'Xàtɔ́ lɛ́',
      uniqueVisitors: 'Mɛ vòvò lɛ́',
      reactions: 'Xó-sín-nú bǐ',
      engagementRate: 'Kɛ́n wǎn-yíyí tɔn',
      reactionChanges: 'Linlin ɖíɖyɔ́ lɛ́',
      languageBreakdown: 'Gbè lɛ́ sín kɛ́n',
      referrers: 'Fí e yě gòsín',
      noDataYet: 'Nǔ ɖě jɛ̀ ɖò fí có ǎ.',
      postColumn: 'Xówlǎn',
      viewsShort: 'xàtɔ́',
      reactionsShort: 'xó-sín-nú',
      noViewsYet: 'Mɛ ɖě xà có ǎ',
      noReferrersYet: 'Fí ɖě gòsín có ǎ',
    },
    library: {
      title: 'Wěmá-xɔ',
      categories: 'Akɔ́ta lɛ́',
      tags: 'Wuntun lɛ́',
      media: 'Fɔtóo lɛ́',
      uploadImage: 'Sɛ́ fɔtóo dó',
      copyMarkdown: 'Wlí Markdown',
      markdownCopied: 'Wlí alɔ-kán fɔtóo Markdown tɔn fó.',
      invalidImageType: 'Fɔtóo élɔ́ sɔ́gbè ǎ (PNG, JPEG, WebP alǒ GIF kɛ́ɖɛ́).',
      imageTooLarge: 'Fɔtóo ɔ́ kló ɖín (5 Mo jɛ̀n jɛ̀).',
      uploadSuccess: 'Fɔtóo byɔ́ mɛ gànjí.',
      uploadError: 'Fɔtóo sɛ́dó gló.',
      deleteMediaConfirm: 'Súnsún fɔtóo élɔ́?',
      deleteTaxonomyConfirm: 'Súnsún?',
      noMedia: 'Fɔtóo ɖě ɖò azɔ̌tɛ́n élɔ́ mɛ ǎ.',
      noCategories: 'Akɔ́ta ɖě ɖò fí có ǎ.',
      noTags: 'Wuntun ɖě ɖò fí có ǎ.',
    },
    settings: {
      title: 'Tòtò-tɛ́n',
      workspace: 'Nyǐkɔ azɔ̌tɛ́n tɔn',
      teamRoles: 'Azɔ̌watɔ́ lɛ́',
      backups: 'Hɛn-ɖó & Lɛ́-kɔ-wá',
      auditLogs: 'Wěmá-xɔ́ ayǐkúngban tɔn',
      exportBackup: 'Ðè JSON tɔ́n',
      restoreBackup: 'Lɛ́ kɔ wá sín JSON',
      brandNameLabel: 'Nyǐkɔ tò-bǐ tɔn (brandName)',
      workspaceNameLabel: 'Nyǐkɔ azɔ̌tɛ́n mɛ tɔn',
      workspaceSlugLabel: 'Alɔ-kán azɔ̌tɛ́n tɔn',
      defaultLocaleLabel: 'Gbè nukɔntɔn',
      publicUrlLabel: 'Alɔ-kán tò-bǐ tɔn',
      invalidUrlHint: 'Alɔ-kán http(s) jɔwɛ alǒ vɔ̌.',
      inviteEmailPlaceholder: 'azɔwatɔ@domaine.org',
      inviteCreated: 'Gbe-byɔ́ bló nú',
      inviteTokenOnceNotice: 'Wlí gbe-kán élɔ́ dìn: é sɔ́ ná tɔ́n gǔdo ǎ.',
      copyToken: 'Wlí gbe-kán',
      inviteRevoked: 'Gbe-byɔ́ gblé.',
      joinedWorkspace: 'A byɔ́ azɔ̌tɛ́n mɛ.',
      roleUpdated: 'Azɔ̌ ɖyɔ́.',
      revokedAction: 'Alɔ-tɔ́n ɖè sín mɛ.',
      invitationsTitle: 'Gbe-byɔ́ e ɖò tè lɛ́',
      joinAnotherTitle: 'Byɔ́ azɔ̌tɛ́n ɖěvó mɛ',
      auditDate: 'Azǎn',
      auditActor: 'Mɛ',
      auditAction: 'Azɔ̌',
      auditDetails: 'Tinmɛ',
      auditRestrictedNote: 'Gǎn kpódó wlǎnwátɔ́ kpán kɛ́ɖɛ́ wɛ síxú kpɔ́n wěmá-xɔ́ élɔ́.',
      restoreSuccess: 'Nǔ {count} lɛ́ kɔ wá gànjí.',
      restoreInvalid: 'Wěmá JSON sɔ́gbè ǎ.',
      workspaceCol: 'ID Azɔ̌tɛ́n',
      tokenCol: 'Gbe-kán',
      noAuditLogs: 'Wěmá-xɔ́ ɖě ɖò fí có ǎ.',
      confirmRemoveMember: 'Ðè mɛ élɔ́ tɔ́n?',
      confirmRevokeInvite: 'Sú gbe-byɔ́ élɔ́?',
      inviteButton: 'Ylɔ́ mɛ',
      roleCol: 'Azɔ̌',
      memberCol: 'Azɔ̌watɔ́',
    },
    publicReader: {
      allArticles: 'Xówlǎn bǐ',
      readArticle: 'Xà xówlǎn',
      readingTime: 'cɛju xàxà',
      publishedOn: 'É tɔ́n ɖò',
      relatedArticles: 'Xówlǎn ɖěvó lɛ́',
      noArticles: 'Xówlǎn ɖě ɖò gbè élɔ́ mɛ có ǎ.',
      switchLanguage: 'Gbè',
      studioLink: 'AILEA Tɛ́n',
      reactionRateLimitError: 'A sɛ́ xó-sín-nú gègè ɖín. Nɔ̀ tè kpɛ̀ɖé.',
      reactionSessionError: 'Lɛ́ jlá wěmá ɔ́ hwɛ̌ cóbónú a nǎ sɛ́ xó-sín-nú dó.',
    },
  },
};

export const FONGBE_CHARACTER_BAR = [
  { char: 'ɛ', label: 'ɛ (open e)' },
  { char: 'Ɛ', label: 'Ɛ' },
  { char: 'ɔ', label: 'ɔ (open o)' },
  { char: 'Ɔ', label: 'Ɔ' },
  { char: 'ɖ', label: 'ɖ (retroflex d)' },
  { char: 'Ɖ', label: 'Ɖ' },
  { char: '\u0301', label: '´ (ton haut)' },
  { char: '\u0300', label: '` (ton bas)' },
  { char: '\u030C', label: 'ˇ (ton montant)' },
  { char: 'ɛ́', label: 'ɛ́' },
  { char: 'ɛ̀', label: 'ɛ̀' },
  { char: 'ɔ́', label: 'ɔ́' },
  { char: 'ɔ̀', label: 'ɔ̀' },
  { char: 'ɖò', label: 'ɖò' },
];
