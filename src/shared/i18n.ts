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
  };
  library: {
    title: string;
    categories: string;
    tags: string;
    media: string;
    uploadImage: string;
  };
  settings: {
    title: string;
    workspace: string;
    teamRoles: string;
    backups: string;
    auditLogs: string;
    exportBackup: string;
    restoreBackup: string;
  };
  publicReader: {
    allArticles: string;
    readArticle: string;
    readingTime: string;
    publishedOn: string;
    relatedArticles: string;
    noArticles: string;
    switchLanguage: string;
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
    },
    library: {
      title: 'Bibliothèque de contenu',
      categories: 'Catégories',
      tags: 'Étiquettes',
      media: 'Médias validés',
      uploadImage: 'Téléverser une image',
    },
    settings: {
      title: 'Paramètres de l’espace',
      workspace: 'Identité éditoriale',
      teamRoles: 'Équipe & Rôles RBAC',
      backups: 'Sauvegardes & Restauration',
      auditLogs: 'Journal d’audit sécurité',
      exportBackup: 'Exporter sauvegarde JSON',
      restoreBackup: 'Restaurer depuis JSON',
    },
    publicReader: {
      allArticles: 'Toutes les publications',
      readArticle: 'Lire l’article',
      readingTime: 'min de lecture',
      publishedOn: 'Publié le',
      relatedArticles: 'À lire également',
      noArticles: 'Aucun article publié dans cette langue pour le moment.',
      switchLanguage: 'Langue',
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
    },
    library: {
      title: 'Content Library',
      categories: 'Categories',
      tags: 'Tags',
      media: 'Media Assets',
      uploadImage: 'Upload Image',
    },
    settings: {
      title: 'Workspace Settings',
      workspace: 'Editorial Identity',
      teamRoles: 'Team & RBAC Roles',
      backups: 'Backups & Restore',
      auditLogs: 'Security Audit Logs',
      exportBackup: 'Export JSON Backup',
      restoreBackup: 'Restore from JSON',
    },
    publicReader: {
      allArticles: 'All Publications',
      readArticle: 'Read article',
      readingTime: 'min read',
      publishedOn: 'Published on',
      relatedArticles: 'Related reading',
      noArticles: 'No published articles in this language yet.',
      switchLanguage: 'Language',
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
    },
    library: {
      title: 'Wěmá-xɔ',
      categories: 'Akɔ́ta lɛ́',
      tags: 'Wuntun lɛ́',
      media: 'Fɔtóo lɛ́',
      uploadImage: 'Sɛ́ fɔtóo dó',
    },
    settings: {
      title: 'Tòtò-tɛ́n',
      workspace: 'Nyǐkɔ azɔ̌tɛ́n tɔn',
      teamRoles: 'Azɔ̌watɔ́ lɛ́',
      backups: 'Hɛn-ɖó & Lɛ́-kɔ-wá',
      auditLogs: 'Wěmá-xɔ́ ayǐkúngban tɔn',
      exportBackup: 'Ðè JSON tɔ́n',
      restoreBackup: 'Lɛ́ kɔ wá sín JSON',
    },
    publicReader: {
      allArticles: 'Xówlǎn bǐ',
      readArticle: 'Xà xówlǎn',
      readingTime: 'cɛju xàxà',
      publishedOn: 'É tɔ́n ɖò',
      relatedArticles: 'Xówlǎn ɖěvó lɛ́',
      noArticles: 'Xówlǎn ɖě ɖò gbè élɔ́ mɛ có ǎ.',
      switchLanguage: 'Gbè',
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
