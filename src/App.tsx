import React, { useState } from 'react';
import { AuthProvider } from './contexts/AuthContext.tsx';
import { I18nProvider } from './contexts/I18nContext.tsx';
import { StudioModuleId, StudioShell } from './components/StudioShell.tsx';
import { AnalyticsModule } from './modules/AnalyticsModule.tsx';
import { ContentLibraryModule } from './modules/ContentLibraryModule.tsx';
import { DashboardModule } from './modules/DashboardModule.tsx';
import { PostManagerModule } from './modules/PostManagerModule.tsx';
import { ReactionStudioModule } from './modules/ReactionStudioModule.tsx';
import { SeoStudioModule } from './modules/SeoStudioModule.tsx';
import { SettingsModule } from './modules/SettingsModule.tsx';
import { TranslationStudioModule } from './modules/TranslationStudioModule.tsx';

function StudioWorkspace() {
  const [activeModule, setActiveModule] = useState<StudioModuleId>('dashboard');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [openCreateModal, setOpenCreateModal] = useState(false);
  const [openImportModal, setOpenImportModal] = useState(false);

  const handleNavigate = (mod: StudioModuleId, postId?: string) => {
    if (postId) setSelectedPostId(postId);
    setActiveModule(mod);
  };

  return (
    <StudioShell activeModule={activeModule} onSelectModule={setActiveModule}>
      {activeModule === 'dashboard' && (
        <DashboardModule
          onNavigate={handleNavigate}
          onTriggerNewPost={() => {
            setOpenImportModal(false);
            setOpenCreateModal(true);
            setActiveModule('posts');
          }}
          onTriggerImport={() => {
            setOpenCreateModal(false);
            setOpenImportModal(true);
            setActiveModule('posts');
          }}
        />
      )}
      {activeModule === 'posts' && (
        <PostManagerModule
          selectedPostId={selectedPostId}
          onSelectPost={setSelectedPostId}
          openCreateModal={openCreateModal}
          openImportModal={openImportModal}
          onCloseModals={() => {
            setOpenCreateModal(false);
            setOpenImportModal(false);
          }}
        />
      )}
      {activeModule === 'translations' && (
        <TranslationStudioModule
          selectedPostId={selectedPostId}
          onSelectPost={setSelectedPostId}
        />
      )}
      {activeModule === 'reactions' && (
        <ReactionStudioModule
          selectedPostId={selectedPostId}
          onSelectPost={setSelectedPostId}
        />
      )}
      {activeModule === 'seo' && (
        <SeoStudioModule
          selectedPostId={selectedPostId}
          onSelectPost={setSelectedPostId}
        />
      )}
      {activeModule === 'analytics' && <AnalyticsModule />}
      {activeModule === 'library' && <ContentLibraryModule />}
      {activeModule === 'settings' && <SettingsModule />}
    </StudioShell>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <StudioWorkspace />
      </AuthProvider>
    </I18nProvider>
  );
}
