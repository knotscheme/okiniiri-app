import {
  Page,
  Layout,
  Card,
  Text,
  Button,
  Grid,
  BlockStack,
  List,
  Box,
  Badge,
  Divider,
  InlineStack,
  Banner
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { useLoaderData, useSubmit } from "react-router";
import db from "../db.server";

const PLAN_STANDARD = "Standard Plan";
const PLAN_PRO = "Pro Plan";

// ==========================================
// 1. ページ読み込み時の処理
// ==========================================
export const loader = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);
  
  let hasStandard = false;
  let hasPro = false;
  let language = "en"; 
  let isFounder = false;

  try {
    const billingCheck = await billing.check();
    const activeSubscriptions = billingCheck.appSubscriptions || [];
    hasStandard = activeSubscriptions.some(s => s.name === PLAN_STANDARD);
    hasPro = activeSubscriptions.some(s => s.name === PLAN_PRO);
  } catch (error) {
    console.error("Billing check error:", error);
  }

  try {
    const settings = await db.emailSetting.findUnique({ where: { shop: session.shop } });
    if (settings && settings.language) {
      language = settings.language;
    }
  } catch (error) {
    console.error("Language fetch error:", error);
  }

  try {
    const appUsage = await db.appUsage.findUnique({ where: { shop: session.shop } });
    if (appUsage && appUsage.isFounder) {
      isFounder = true;
    }
  } catch (error) {
    console.error("AppUsage fetch error:", error);
  }

  return { hasStandard, hasPro, language, isFounder };
};

// ==========================================
// 2. ボタンを押した時の処理
// ==========================================
export const action = async ({ request }) => {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const plan = formData.get("plan");

  return await billing.request({
    plan: plan,
    isTest: true,
  });
};

// ==========================================
// 3. 画面のデザイン
// ==========================================
export default function PricingPage() {
  const { hasStandard, hasPro, language, isFounder } = useLoaderData();
  const submit = useSubmit();

  const handleUpgrade = (planName) => {
    submit({ plan: planName }, { method: "post" });
  };

  const isFree = !hasStandard && !hasPro;

  const translations = {
    ja: {
      page_title: "料金プラン (Pricing)",
      page_sub: "あなたのビジネスの規模に合わせた最適なプランをお選びください。有料プランはすべて30日間の無料お試しが可能です。",
      free_desc: "お試しや小規模ストア向け",
      standard_desc: "本格的な運用とグローバル展開へ",
      pro_desc: "データ分析と売上最大化を目指す方へ",
      popular: "一番人気",
      mo: "/月",
      current_plan: "現在のプラン",
      cannot_select: "選択不可",
      trial_btn: "30日間無料で試す",
      free_f1: "再入荷通知：月50通まで",
      free_f2: "お気に入りボタン（デザイン変更可）",
      free_f3: "マイページ「お気に入り一覧」",
      free_f4: "テストメール送信機能",
      free_f5: "対応言語：日・英のみ",
      std_f1: "Freeプランのすべての機能",
      std_f2: "再入荷通知：",
      std_unlimited: "無制限 *",
      std_f3: "6カ国語フル対応", 
      std_f4: "（日/英/中/仏/独/西）",
      std_f5: "優先メール送信サーバー", 
      pro_f1: "Standardのすべての機能",
      pro_f2: "高度な分析ダッシュボード",
      pro_f3: "流入元トラッキング・CV分析", // ★修正: 機能の重複を避け、強力な機能をアピール
      pro_f4: "CSVデータエクスポート",
      pro_f5: "優先カスタマーサポート",
      disclaimer: "* 適正利用規約 (Fair Use Policy): スパム行為やシステムの過負荷を防止するため、StandardおよびProプランにおける再入荷通知メールの送信は、1ストアあたり月間10,000通を実質的な上限とさせていただいております。通常の店舗運営においてこの上限を超えることはほぼありませんのでご安心ください。",
      founder_banner_title: "✨ あなたはFounderメンバーです！",
      founder_banner_desc: "特別なFounderプランが適用されています。StandardおよびProのすべての機能が永久無料でご利用いただけます。",
      included_in_founder: "Founderプラン適用中"
    },
    en: {
      page_title: "Pricing Plans",
      page_sub: "Choose the best plan for your business size. All paid plans include a 30-day free trial.",
      free_desc: "For testing and small stores",
      standard_desc: "For full-scale operations & global reach",
      pro_desc: "For data analysis & maximizing sales",
      popular: "Most Popular",
      mo: "/mo",
      current_plan: "Current Plan",
      cannot_select: "Unavailable",
      trial_btn: "Start 30-Day Free Trial",
      free_f1: "Restock Alerts: Up to 50/mo",
      free_f2: "Wishlist Button (Customizable)",
      free_f3: "My Page Wishlist",
      free_f4: "Test Email Function",
      free_f5: "Languages: EN & JA only",
      std_f1: "All Free plan features",
      std_f2: "Restock Alerts: ",
      std_unlimited: "Unlimited *",
      std_f3: "All 6 Languages Unlocked",
      std_f4: "(JA/EN/ZH/FR/DE/ES)",
      std_f5: "Priority Email Server", 
      pro_f1: "All Standard plan features",
      pro_f2: "Advanced Analytics Dashboard",
      pro_f3: "Traffic Source & CV Tracking", // ★修正
      pro_f4: "CSV Data Export",
      pro_f5: "Priority Customer Support",
      disclaimer: "* Fair Use Policy: To prevent spam and system overload, restock notification emails on Standard and Pro plans are practically capped at 10,000 emails per month per store. Normal store operations rarely exceed this limit.",
      founder_banner_title: "✨ You are a Founder Member!",
      founder_banner_desc: "The special Founder Plan is applied. All Standard and Pro features are yours forever for free.",
      included_in_founder: "Founder Plan Applied"
    },
    zh: {
      page_title: "定价计划 (Pricing)",
      page_sub: "选择适合您业务规模的最佳计划。所有付费计划均包含30天免费试用。",
      free_desc: "适用于测试和小型商店",
      standard_desc: "适用于全面运营和全球扩展",
      pro_desc: "适用于数据分析和最大化销售",
      popular: "最受欢迎",
      mo: "/月",
      current_plan: "当前计划",
      cannot_select: "不可选",
      trial_btn: "免费试用 30 天",
      free_f1: "到货通知：每月最多 50 封",
      free_f2: "心愿单按钮 (可自定义设计)",
      free_f3: "我的主页心愿单",
      free_f4: "测试邮件发送功能",
      free_f5: "支持语言：仅中/英/日",
      std_f1: "Free 计划的所有功能",
      std_f2: "到货通知：",
      std_unlimited: "无限制 *",
      std_f3: "完全支持 6 种语言",
      std_f4: "(日/英/中/法/德/西)",
      std_f5: "优先邮件发送服务器",
      pro_f1: "Standard 计划的所有功能",
      pro_f2: "高级分析仪表板",
      pro_f3: "流量来源与转化追踪", // ★修正
      pro_f4: "CSV 数据导出",
      pro_f5: "优先客户支持",
      disclaimer: "* 合理使用政策 (Fair Use Policy)：为了防止垃圾邮件和系统过载，Standard和Pro计划的到货通知邮件每个商店每月实际限制为10,000封。正常运营极少会超过此限制。",
      founder_banner_title: "✨ 您是创始人成员！",
      founder_banner_desc: "已应用特殊的创始人计划。您可以永久免费使用所有 Standard 和 Pro 功能。",
      included_in_founder: "创始人计划适用中"
    },
    fr: {
      page_title: "Forfaits et Tarifs",
      page_sub: "Choisissez le forfait adapté à votre entreprise. Essai gratuit de 30 jours pour tous les forfaits payants.",
      free_desc: "Pour les tests et petites boutiques",
      standard_desc: "Pour les opérations globales",
      pro_desc: "Pour l'analyse de données et les ventes",
      popular: "Populaire",
      mo: "/mois",
      current_plan: "Forfait actuel",
      cannot_select: "Indisponible",
      trial_btn: "Essai gratuit de 30 jours",
      free_f1: "Alertes de stock : jusqu'à 50/mois",
      free_f2: "Bouton Liste de souhaits (Personnalisable)",
      free_f3: "Page Liste de souhaits",
      free_f4: "Fonction d'e-mail de test",
      free_f5: "Langues : EN & JA",
      std_f1: "Toutes les fonctions Free",
      std_f2: "Alertes de stock : ",
      std_unlimited: "Illimité *",
      std_f3: "6 langues débloquées",
      std_f4: "(JA/EN/ZH/FR/DE/ES)",
      std_f5: "Serveur d'e-mail prioritaire",
      pro_f1: "Toutes les fonctions Standard",
      pro_f2: "Tableau de bord analytique avancé",
      pro_f3: "Suivi des sources et des conversions", // ★修正
      pro_f4: "Exportation de données CSV",
      pro_f5: "Support client prioritaire",
      disclaimer: "* Politique d'utilisation équitable : Pour éviter le spam, les e-mails de notification sur les forfaits payants sont limités à 10 000 par mois par boutique. Les opérations normales dépassent rarement cette limite.",
      founder_banner_title: "✨ Vous êtes un membre Founder !",
      founder_banner_desc: "Le plan spécial Founder est appliqué. Toutes les fonctionnalités Standard et Pro sont gratuites à vie.",
      included_in_founder: "Plan Founder Appliqué"
    },
    de: {
      page_title: "Preispläne",
      page_sub: "Wählen Sie den besten Plan für Ihr Unternehmen. Alle kostenpflichtigen Pläne bieten eine 30-tägige Testversion.",
      free_desc: "Für Tests und kleine Shops",
      standard_desc: "Für globale Expansion",
      pro_desc: "Für Datenanalyse und Umsatzsteigerung",
      popular: "Am beliebtesten",
      mo: "/Monat",
      current_plan: "Aktueller Plan",
      cannot_select: "Nicht verfügbar",
      trial_btn: "30 Tage kostenlos testen",
      free_f1: "Wiederaufstockungs-Alarme: bis zu 50/Monat",
      free_f2: "Wunschzettel-Button (Anpassbar)",
      free_f3: "Meine Wunschzettel-Seite",
      free_f4: "Test-E-Mail-Funktion",
      free_f5: "Sprachen: Nur EN & JA",
      std_f1: "Alle Free-Funktionen",
      std_f2: "Wiederaufstockungs-Alarme: ",
      std_unlimited: "Unbegrenzt *",
      std_f3: "Alle 6 Sprachen freigeschaltet",
      std_f4: "(JA/EN/ZH/FR/DE/ES)",
      std_f5: "Priorisierter E-Mail-Server",
      pro_f1: "Alle Standard-Funktionen",
      pro_f2: "Erweitertes Analyse-Dashboard",
      pro_f3: "Traffic-Quellen & CV-Tracking", // ★修正
      pro_f4: "CSV-Datenexport",
      pro_f5: "Priorisierter Kundensupport",
      disclaimer: "* Fair-Use-Richtlinie: Um Spam zu vermeiden, sind Benachrichtigungs-E-Mails in kostenpflichtigen Plänen auf 10.000 E-Mails pro Monat pro Shop begrenzt. Der normale Shop-Betrieb überschreitet dieses Limit selten.",
      founder_banner_title: "✨ Sie sind ein Founder-Mitglied!",
      founder_banner_desc: "Der spezielle Founder-Plan ist angewendet. Alle Standard- und Pro-Funktionen sind dauerhaft kostenlos.",
      included_in_founder: "Founder-Plan angewendet"
    },
    es: {
      page_title: "Planes de Precios",
      page_sub: "Elija el mejor plan para su negocio. Prueba gratuita de 30 días en los planes de pago.",
      free_desc: "Para pruebas y tiendas pequeñas",
      standard_desc: "Para operaciones globales",
      pro_desc: "Para análisis de datos y ventas",
      popular: "Más popular",
      mo: "/mes",
      current_plan: "Plan actual",
      cannot_select: "No disponible",
      trial_btn: "Prueba gratuita de 30 días",
      free_f1: "Alertes de stock: hasta 50/mes",
      free_f2: "Botón Lista de deseos (Personalizable)",
      free_f3: "Mi página de Lista de deseos",
      free_f4: "Función de correo de prueba",
      free_f5: "Idiomas: solo EN y JA",
      std_f1: "Todas las funciones Free",
      std_f2: "Alertas de stock: ",
      std_unlimited: "Ilimitado *",
      std_f3: "Los 6 idiomas desbloqueados",
      std_f4: "(JA/EN/ZH/FR/DE/ES)",
      std_f5: "Servidor de correo prioritario",
      pro_f1: "Todas las funciones Standard",
      pro_f2: "Panel de análisis avanzado",
      pro_f3: "Seguimiento de fuentes y conversiones", // ★修正
      pro_f4: "Exportación de datos CSV",
      pro_f5: "Soporte al cliente prioritario",
      disclaimer: "* Política de uso justo: Para evitar el spam, los correos de notificación en planes de pago están limitados a 10,000 por mes por tienda. Las operaciones normales rara vez superan este límite.",
      founder_banner_title: "✨ ¡Eres un miembro Founder!",
      founder_banner_desc: "Se ha aplicado el plan especial Founder. Todas las funciones Standard y Pro son gratis para siempre.",
      included_in_founder: "Plan Founder Aplicado"
    }
  };

  const t = translations[language] || translations.en;

  return (
    <Page 
      title={t.page_title} 
      subtitle={t.page_sub}
      backAction={{ content: 'Home', onAction: () => window.history.back() }}
    >
      <BlockStack gap="500">
        <Layout>
          {isFounder && (
            <Layout.Section>
              <Banner tone="magic" title={t.founder_banner_title}>
                <p>{t.founder_banner_desc}</p>
              </Banner>
            </Layout.Section>
          )}

          <Layout.Section>
            <Grid>
              {/* ▼▼▼ Free プラン ▼▼▼ */}
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 4, lg: 4 }}>
                <Card roundedAbove="sm">
                  <BlockStack gap="400">
                    <Box>
                      <Text variant="headingLg" as="h2">Free</Text>
                      <Text variant="bodySm" tone="subdued" as="p">{t.free_desc}</Text>
                    </Box>
                    <Text variant="heading3xl" as="p">
                      $0<Text variant="bodySm" as="span" tone="subdued">{t.mo}</Text>
                    </Text>
                    <Divider />
                    <List>
                      <List.Item>{t.free_f1}</List.Item>
                      <List.Item><Text as="span" fontWeight="bold">{t.free_f2}</Text></List.Item>
                      <List.Item>{t.free_f3}</List.Item>
                      <List.Item>{t.free_f4}</List.Item>
                      <List.Item>{t.free_f5}</List.Item>
                    </List>
                    <Box paddingBlockStart="400">
                      <Button fullWidth disabled>
                        {isFounder ? t.cannot_select : (isFree ? t.current_plan : t.cannot_select)}
                      </Button>
                    </Box>
                  </BlockStack>
                </Card>
              </Grid.Cell>

              {/* ▼▼▼ Standard プラン ▼▼▼ */}
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 4, lg: 4 }}>
                <Card roundedAbove="sm" background="bg-surface-secondary">
                  <BlockStack gap="400">
                    <Box>
                      <Box paddingBlockEnd="100">
                        <InlineStack align="start" blockAlign="center" gap="200">
                          <Text variant="headingLg" as="h2">Standard</Text>
                          <Badge tone="attention">{t.popular}</Badge>
                        </InlineStack>
                      </Box>
                      <Text variant="bodySm" tone="subdued" as="p">{t.standard_desc}</Text>
                    </Box>
                    <Text variant="heading3xl" as="p">
                      $9.99<Text variant="bodySm" as="span" tone="subdued">{t.mo}</Text>
                    </Text>
                    <Divider />
                    <List>
                      <List.Item>{t.std_f1}</List.Item>
                      <List.Item>
                        {t.std_f2}
                        <Text as="span" tone="critical" fontWeight="bold">{t.std_unlimited}</Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" fontWeight="bold">{t.std_f3}</Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" tone="subdued">{t.std_f4}</Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span">{t.std_f5}</Text>
                      </List.Item>
                    </List>
                    <Box paddingBlockStart="400">
                      <Button 
                        fullWidth 
                        variant="primary" 
                        onClick={() => handleUpgrade(PLAN_STANDARD)} 
                        disabled={hasStandard || isFounder} 
                      >
                        {isFounder ? t.included_in_founder : (hasStandard ? t.current_plan : t.trial_btn)}
                      </Button>
                    </Box>
                  </BlockStack>
                </Card>
              </Grid.Cell>

              {/* ▼▼▼ Pro プラン ▼▼▼ */}
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 4, lg: 4 }}>
                <Card roundedAbove="sm">
                  <BlockStack gap="400">
                    <Box>
                      <Text variant="headingLg" as="h2">Pro</Text>
                      <Text variant="bodySm" tone="subdued" as="p">{t.pro_desc}</Text>
                    </Box>
                    <Text variant="heading3xl" as="p">
                      $24.99<Text variant="bodySm" as="span" tone="subdued">{t.mo}</Text>
                    </Text>
                    <Divider />
                    <List>
                      <List.Item>{t.pro_f1}</List.Item>
                      <List.Item>
                        <Text as="span" fontWeight="bold">{t.pro_f2}</Text>
                      </List.Item>
                      <List.Item>
                        <Text as="span" fontWeight="bold">{t.pro_f3}</Text> {/* ★修正反映箇所 */}
                      </List.Item>
                      <List.Item>
                        <Text as="span" fontWeight="bold">{t.pro_f4}</Text>
                      </List.Item>
                      <List.Item>{t.pro_f5}</List.Item>
                    </List>
                    <Box paddingBlockStart="400">
                      <Button 
                        fullWidth 
                        onClick={() => handleUpgrade(PLAN_PRO)} 
                        disabled={hasPro || isFounder} 
                      >
                        {isFounder ? t.included_in_founder : (hasPro ? t.current_plan : t.trial_btn)}
                      </Button>
                    </Box>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            </Grid>
          </Layout.Section>

          {/* ▼▼▼ 免責事項 ▼▼▼ */}
          <Layout.Section>
            <Box paddingBlockStart="400" paddingBlockEnd="400">
              <Text variant="bodySm" tone="subdued" alignment="center">
                {t.disclaimer}
              </Text>
            </Box>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}