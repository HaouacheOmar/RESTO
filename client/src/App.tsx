import { BrowserRouter, Navigate, Route, Routes } from 'react-router'

import AuthProvider from './auth/AuthProvider'
import Landing from './landing/Landing'
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from './pages/AuthPages'
import { SpaceHome, SpacePage } from './pages/SpacePage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/connexion" element={<LoginPage />} />
          <Route path="/inscription" element={<RegisterPage />} />
          <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
          <Route path="/mot-de-passe/nouveau" element={<ResetPasswordPage />} />
          <Route path="/espace" element={<SpaceHome />} />
          <Route path="/espace/:slug" element={<SpacePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
