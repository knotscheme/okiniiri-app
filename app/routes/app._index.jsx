import { useState, useEffect } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { 
  Page, Layout, Card, Text, BlockStack, Banner, List, DataTable, Badge, Box, 
  Divider, InlineStack, Button, Icon, InlineGrid, Thumbnail, ProgressBar
} from "@shopify/polaris";
import { 
  CheckCircleIcon, EmailIcon, ChartVerticalIcon, InfoIcon, ViewIcon, GlobeIcon,
  PlayCircleIcon, ViewIcon as ShowIcon, MoneyIcon, ImageIcon, NoteIcon, XIcon,
  StarIcon, ChatIcon, LockIcon // ★ LockIcon を追加
} from '@shopify/polaris-icons'; 
import { authenticate } from "../shopify.server";
import db from "../db.server";

const APP_HANDLE = "wishflow-back-in-stock"; 

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const settings = await db.emailSetting.findUnique({ where: { shop } });
  const lang = settings?.language || 'en';

  let appUsage = await db.appUsage.findUnique({ where: { shop } });
  if (!appUsage) {
    appUsage = await db.appUsage.create({ data: { shop } });
  }

  const shopResponse = await admin.graphql(`{ shop { currencyCode } }`);
  const shopJson = await shopResponse.json();
  const currencyCode = shopJson.data.shop.currencyCode;

  const restockCount = await db.restockRequest.count({ where: { shop, isNotified: false } });
  const totalFavorites = await db.favorite.count({ where: { shop } });
  
  const convertedData = await db.restockRequest.findMany({
    where: { shop, isConverted: true },
    select: { convertedPrice: true }
  });
  const totalRevenue = convertedData.reduce((sum, req) => sum + (req.convertedPrice || 0), 0);

  const allTimeRequests = await db.restockRequest.count({ where: { shop } });
  const convertedCount = convertedData.length;
  const cvRate = allTimeRequests > 0 ? ((convertedCount / allTimeRequests) * 100).toFixed(1) : "0.0";

  const rawTopFavs = await db.favorite.groupBy({ 
    by: ['productHandle'], where: { shop }, _count: { productHandle: true }, 
    orderBy: { _count: { productHandle: 'desc' } }, take: 5 
  });

  const topFavorites = await Promise.all(rawTopFavs.map(async (fav) => {
    let imageUrl = null;
    try {
      const res = await admin.graphql(`query getImg($h: String!){ productByHandle(handle:$h){ featuredImage{url} } }`, { variables: { h: fav.productHandle } });
      const json = await res.json();
      imageUrl = json.data?.productByHandle?.featuredImage?.url;
    } catch (e) {}
    return { ...fav, imageUrl };
  }));

  const recentFavs = await db.favorite.findMany({ where: { shop }, orderBy: { createdAt: 'desc' }, take: 3 });
  const recentRestocks = await db.restockRequest.findMany({ where: { shop }, orderBy: { createdAt: 'desc' }, take: 3 });
  const activities = [...recentFavs.map(f => ({ ...f, type: 'fav' })), ...recentRestocks.map(r => ({ ...r, type: 'restock' }))]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);

  return { 
    restockCount, totalFavorites, totalRevenue, cvRate, topFavorites, activities, 
    currencyCode, lang, shop,
    appUsage 
  };
};

export default function Index() {
  const { restockCount, totalFavorites, totalRevenue, cvRate, topFavorites, activities, currencyCode, lang, shop, appUsage } = useLoaderData();
  const navigate = useNavigate();

  const [completedSteps, setCompletedSteps] = useState([]);
  const [isGuideHidden, setIsGuideHidden] = useState(false);
  const [activeStep, setActiveStep] = useState("1"); 
  const [isLoaded, setIsLoaded] = useState(false);

  // ★ 追加：Pro機能（分析機能）が解放されているかの判定
  const isProUnlocked = appUsage?.isFounder || appUsage?.plan === "pro";

  useEffect(() => {
    const savedSteps = JSON.parse(localStorage.getItem(`wishflow-steps-${shop}`) || "[]");
    const savedHidden = localStorage.getItem(`wishflow-guide-hidden-${shop}`) === "true";
    setCompletedSteps(savedSteps);
    setIsGuideHidden(savedHidden);
    setIsLoaded(true);
  }, [shop]);

  const toggleStepComplete = (stepStr) => {
    const newSteps = completedSteps.includes(stepStr)
      ? completedSteps.filter(s => s !== stepStr)
      : [...completedSteps, stepStr];
    
    setCompletedSteps(newSteps);
    localStorage.setItem(`wishflow-steps-${shop}`, JSON.stringify(newSteps));
    
    if (newSteps.length === 6) {
      setTimeout(() => hideGuide(), 600);
    } else if (!completedSteps.includes(stepStr)) {
      const nextStep = String(parseInt(stepStr) + 1);
      if (parseInt(nextStep) <= 6) setActiveStep(nextStep);
    }
  };

  const toggleAccordion = (stepStr) => {
    setActiveStep(activeStep === stepStr ? null : stepStr);
  };

  const hideGuide = () => {
    setIsGuideHidden(true);
    localStorage.setItem(`wishflow-guide-hidden-${shop}`, "true");
  };

  const showGuide = () => {
    setIsGuideHidden(false);
    localStorage.setItem(`wishflow-guide-hidden-${shop}`, "false");
  };

  const stepsCompletedCount = completedSteps.length;

  const t = {
    ja: {
      title: "ダッシュボード",
      rev_title: "WishFlowの調子はいかがですか？👋",
      rev_desc: "より良い体験をお届けするために、あなたの力を貸していただけませんか？",
      rev_btn: "Rate us on Shopify!",
      guide_title: "セットアップガイド",
      guide_desc: "以下の項目を上から順に設定し、売り切れ時の取りこぼしを削減させ売り上げをアップさせましょう。",
      guide_progress: "6つのタスクのうち {count} 件が完了しました。",
      guide_go: "設定する",
      guide_manual: "詳しい図解マニュアルを見る",
      guide_hide: "ガイドを隠す",
      guide_show: "セットアップガイドを表示",
      guide_complete_msg: "すべての設定が完了しました！",
      kpi_restock: "入荷通知登録数", kpi_fav: "累計お気に入り数", kpi_sales: "アプリ経由の売上", kpi_cv: "コンバージョン率",
      btn_analysis: "分析詳細", activity_title: "最近のアクティビティ", ranking_title: "注目のお気に入り TOP 5",
      col_product: "商品", col_count: "登録数",
      badge_fav: "登録", badge_req: "通知依頼", unit: "件",
      step1: "同期設定", desc1: "まずは、在庫同期が正しく『オン』になっているか、設定するボタンを押して確認しましょう。売り切れによる取りこぼしを防ぎ、スムーズな販売をスタートできます。",
      step2: "メール設定", desc2: "通知メールはブランドの印象を左右する大切な接点です。ショップ名や文面をあなたらしく整えて、お客様の心に届く特別なメッセージへとカスタマイズしましょう。",
      step3: "ボタン配置", desc3: "商品ページに「再入荷通知」ボタンを表示させましょう。お客様の「欲しい」を逃さず、入荷した瞬間に自動でお知らせ。売上の取りこぼしを確実に防ぎます。",
      step4: "マイページ作成", desc4: "お気に入りリストとサブボタンを有効化して、お客様の「気になる」をキープしましょう。後から見返せる利便性が、再来店と購入を強力に後押しします。",
      step5: "テスト送信", desc5: "設定が完了したら、実際に通知が届くかテストメールを送ってみましょう。お客様に届く内容を自分の目で確かめることで、安心して運用をスタートできます。",
      step6: "分析の活用", desc6: "お気に入り数や入荷通知のデータを分析し、人気の傾向を把握しましょう。需要を予測して的確な仕入れに繋げることで、欠品や在庫過多の悩みを解消できます。※Proプランより解放",
      video_placeholder: "導入解説動画 (準備中)",
      lang_card_title: "言語設定", lang_card_desc: "表示言語を変更します。", lang_card_btn: "変更する",
      app_info: "アプリ情報", app_desc: "WishFlow: 顧客の「欲しい」を可視化し、機会損失を防ぐシステム。",
      plan_title: "現在のプラン", plan_current: "適用中", btn_plan: "プランを確認・変更する",
      feedback_title: "フィードバック・お問い合わせ", feedback_desc: "アプリの改善にご協力ください。お困りの際もお気軽にどうぞ。", btn_feedback: "サポートに連絡する",
      // ★ 追加：ロック画面用のテキスト
      pro_lock_title: "Proプランで詳細な分析を解放",
      pro_lock_desc: "どの商品が最もお気に入りされているか、入荷通知の需要が高いかを可視化できます。",
      btn_upgrade: "アップグレードする"
    },
    en: {
      title: "Dashboard",
      rev_title: "How is WishFlow working for you? 👋",
      rev_desc: "If you have a moment, we'd appreciate your review.",
      rev_btn: "Rate us on Shopify!",
      guide_title: "Setup Guide",
      guide_desc: "Complete the following steps in order to reduce lost sales and boost your revenue.",
      guide_progress: "{count} of 6 tasks completed.",
      guide_go: "Go to Settings",
      guide_manual: "View Detailed Guide",
      guide_hide: "Hide Guide",
      guide_show: "Show Setup Guide",
      guide_complete_msg: "All setup steps completed!",
      kpi_restock: "Restock Requests", kpi_fav: "Total Favorites", kpi_sales: "App Revenue", kpi_cv: "Conversion Rate",
      btn_analysis: "Analysis", activity_title: "Recent Activity", ranking_title: "Top 5 Wishlist Items",
      col_product: "Product", col_count: "Count",
      badge_fav: "Fav", badge_req: "Request", unit: "",
      step1: "Sync Check", desc1: "First, ensure auto-sync is enabled. This prevents lost sales and ensures a smooth start.",
      step2: "Email Setup", desc2: "Customize your store name and message to create a unique notification email for your customers.",
      step3: "Add Button", desc3: "Place the 'Notify Me' button on product pages. Never miss a customer's desire to buy.",
      step4: "Create Page", desc4: "Enable the wishlist so customers can save their favorites, encouraging return visits.",
      step5: "Test Notification", desc5: "Send a test email to ensure your notifications are delivered correctly.",
      step6: "Use Analytics", desc6: "Analyze favorites and requests to spot trends and optimize your inventory. *Pro plan required",
      video_placeholder: "Setup Video (Coming Soon)",
      lang_card_title: "Language", lang_card_desc: "Change display language.", lang_card_btn: "Change",
      app_info: "App Info", app_desc: "WishFlow: Visualize demand and prevent lost sales.",
      plan_title: "Current Plan", plan_current: "Active", btn_plan: "View / Change Plan",
      feedback_title: "Feedback & Support", feedback_desc: "Help us improve. Feel free to reach out if you need assistance.", btn_feedback: "Contact Support",
      pro_lock_title: "Unlock Advanced Analytics with Pro",
      pro_lock_desc: "Visualize which products are most favorited and in high demand.",
      btn_upgrade: "Upgrade Now"
    },
    zh: {
      title: "仪表板",
      rev_title: "WishFlow 运行得怎么样？👋",
      rev_desc: "为了提供更好的体验，您能协助我们吗？",
      rev_btn: "在 Shopify 上评价我们！",
      guide_title: "设置指南",
      guide_desc: "请从上到下完成以下设置，减少缺货损失，提升销售额。",
      guide_progress: "6 个任务中已完成 {count} 个。",
      guide_go: "去设置",
      guide_manual: "查看详细图文教程",
      guide_hide: "隐藏指南",
      guide_show: "显示设置指南",
      guide_complete_msg: "所有设置已完成！",
      kpi_restock: "到货通知注册数", kpi_fav: "累计收藏数", kpi_sales: "应用促成销售额", kpi_cv: "转化率",
      btn_analysis: "详细分析", activity_title: "近期活动", ranking_title: "热门收藏 TOP 5",
      col_product: "商品", col_count: "数量",
      badge_fav: "收藏", badge_req: "请求", unit: "件",
      step1: "同步设置", desc1: "首先，点击设置按钮检查库存同步是否已正确“开启”。这能防止流失，让您的销售更顺畅。",
      step2: "邮件设置", desc2: "通知邮件是影响品牌印象的重要接触点。请自定义内容，打造触动顾客的专属信息。",
      step3: "按钮放置", desc3: "在商品页面显示“到货通知”按钮。抓住顾客的购买欲，切实防止销售流失。",
      step4: "收藏页设置", desc4: "启用收藏列表，保留顾客的心愿单。方便日后查看，强力推动再次访问和购买。",
      step5: "测试发送", desc5: "设置完成后，发送一封测试邮件，亲眼确认顾客收到的内容，让您安心运营。",
      step6: "数据分析", desc6: "分析收藏数和通知数据，掌握热门趋势进行精准采购。※Pro 计划及以上可用",
      video_placeholder: "安装说明视频 (准备中)",
      lang_card_title: "语言设置", lang_card_desc: "更改显示语言。", lang_card_btn: "更改",
      app_info: "应用信息", app_desc: "WishFlow: 将顾客需求可视化，防止销售流失。",
      plan_title: "当前计划", plan_current: "使用中", btn_plan: "查看/更改计划",
      feedback_title: "反馈与支持", feedback_desc: "帮助我们改进应用。如果您需要帮助，请随时联系我们。", btn_feedback: "联系支持",
      pro_lock_title: "升级 Pro 解锁高级分析",
      pro_lock_desc: "可视化哪些产品最受欢迎以及需求量最大。",
      btn_upgrade: "立即升级"
    },
    fr: {
      title: "Tableau de bord",
      rev_title: "Comment se passe l'utilisation de WishFlow ? 👋",
      rev_desc: "Pourriez-vous nous aider à vous offrir une meilleure expérience ?",
      rev_btn: "Évaluez-nous sur Shopify !",
      guide_title: "Guide de configuration",
      guide_desc: "Veuillez configurer les éléments ci-dessous pour réduire les pertes dues aux ruptures de stock.",
      guide_progress: "{count} sur 6 tâches terminées.",
      guide_go: "Configurer",
      guide_manual: "Voir le guide détaillé",
      guide_hide: "Masquer le guide",
      guide_show: "Afficher le guide",
      guide_complete_msg: "Toutes les configurations sont terminées !",
      kpi_restock: "Demandes réassort", kpi_fav: "Total des favoris", kpi_sales: "Ventes de l'application", kpi_cv: "Taux de conversion",
      btn_analysis: "Analyse", activity_title: "Activité récente", ranking_title: "Top 5 des favoris",
      col_product: "Produit", col_count: "Nombre",
      badge_fav: "Favori", badge_req: "Demande", unit: "",
      step1: "Synchro. des stocks", desc1: "Vérifiez que la synchronisation est activée pour éviter les pertes et démarrer en douceur.",
      step2: "Paramètres e-mail", desc2: "Personnalisez votre e-mail pour créer un message unique qui touchera vos clients.",
      step3: "Placement du bouton", desc3: "Affichez le bouton 'M'alerter' sur la page produit. Ne manquez aucune envie d'achat.",
      step4: "Page de favoris", desc4: "Activez la liste de favoris pour conserver les envies de vos clients et encourager le retour.",
      step5: "Envoi de test", desc5: "Envoyez un e-mail de test pour vous assurer du bon fonctionnement des alertes.",
      step6: "Analyse des données", desc6: "Analysez les favoris pour cerner les tendances et optimiser votre stock. *Plan Pro",
      video_placeholder: "Vidéo d'installation (Bientôt)",
      lang_card_title: "Langue", lang_card_desc: "Modifier la langue d'affichage.", lang_card_btn: "Modifier",
      app_info: "Infos de l'app", app_desc: "WishFlow : Visualisez la demande et prévenez les pertes.",
      plan_title: "Forfait actuel", plan_current: "Actif", btn_plan: "Voir / Changer le forfait",
      feedback_title: "Commentaires & Support", feedback_desc: "Aidez-nous à nous améliorer. Contactez-nous si vous avez besoin d'aide.", btn_feedback: "Contacter le support",
      pro_lock_title: "Débloquez l'analyse avancée avec Pro",
      pro_lock_desc: "Visualisez quels produits sont les plus favoris et très demandés.",
      btn_upgrade: "Mettre à niveau"
    },
    de: {
      title: "Dashboard",
      rev_title: "Wie läuft es mit WishFlow? 👋",
      rev_desc: "Könnten Sie uns helfen, Ihnen ein besseres Erlebnis zu bieten?",
      rev_btn: "Bewerten Sie uns auf Shopify!",
      guide_title: "Einrichtungsleitfaden",
      guide_desc: "Richten Sie die folgenden Elemente ein, um Verluste durch ausverkaufte Artikel zu reduzieren.",
      guide_progress: "{count} von 6 Aufgaben abgeschlossen.",
      guide_go: "Einrichten",
      guide_manual: "Detaillierte Anleitung",
      guide_hide: "Ausblenden",
      guide_show: "Leitfaden anzeigen",
      guide_complete_msg: "Alle Einrichtungen abgeschlossen!",
      kpi_restock: "Benachrichtigungen", kpi_fav: "Gesamte Favoriten", kpi_sales: "App-Umsatz", kpi_cv: "Konversionsrate",
      btn_analysis: "Analyse", activity_title: "Kürzliche Aktivität", ranking_title: "Top 5 Favoriten",
      col_product: "Produkt", col_count: "Anzahl",
      badge_fav: "Favorit", badge_req: "Anfrage", unit: "",
      step1: "Synchronisierung", desc1: "Prüfen Sie, ob die Bestandssynchronisierung aktiviert ist, um reibungslos zu starten.",
      step2: "E-Mail-Setup", desc2: "Passen Sie den Shopnamen an, um eine besondere Nachricht an Kunden zu senden.",
      step3: "Button-Platzierung", desc3: "Zeigen Sie den 'Benachrichtigen'-Button an. Verpassen Sie keine Kundenwünsche.",
      step4: "Wunschliste erstellen", desc4: "Aktivieren Sie die Wunschliste, damit Kunden ihre Favoriten speichern können.",
      step5: "Testversand", desc5: "Senden Sie eine Test-E-Mail, um sicherzustellen, dass alles funktioniert.",
      step6: "Analyse nutzen", desc6: "Analysieren Sie Favoriten, um Trends zu erkennen und den Einkauf zu optimieren. *Pro-Plan",
      video_placeholder: "Installationsvideo (In Kürze)",
      lang_card_title: "Sprache", lang_card_desc: "Anzeigesprache ändern.", lang_card_btn: "Ändern",
      app_info: "App-Info", app_desc: "WishFlow: Nachfrage visualisieren und Verluste verhindern.",
      plan_title: "Aktueller Plan", plan_current: "Aktiv", btn_plan: "Plan ansehen/ändern",
      feedback_title: "Feedback & Support", feedback_desc: "Helfen Sie uns bei der Verbesserung. Kontaktieren Sie uns bei Bedarf.", btn_feedback: "Support kontaktieren",
      pro_lock_title: "Erweiterte Analysen mit Pro freischalten",
      pro_lock_desc: "Visualisieren Sie, welche Produkte am beliebtesten und am meisten gefragt sind.",
      btn_upgrade: "Jetzt upgraden"
    },
    es: {
      title: "Panel",
      rev_title: "¿Qué tal su experiencia con WishFlow? 👋",
      rev_desc: "¿Podría ayudarnos a ofrecerle una mejor experiencia?",
      rev_btn: "¡Califíquenos en Shopify!",
      guide_title: "Guía de configuración",
      guide_desc: "Configure los siguientes elementos para reducir las pérdidas por falta de stock.",
      guide_progress: "{count} de 6 tareas completadas.",
      guide_go: "Configurar",
      guide_manual: "Ver guía detallada",
      guide_hide: "Ocultar guía",
      guide_show: "Mostrar guía",
      guide_complete_msg: "¡Configuración completada!",
      kpi_restock: "Solicitudes de stock", kpi_fav: "Total de favoritos", kpi_sales: "Ventas por la app", kpi_cv: "Tasa de conversión",
      btn_analysis: "Análisis", activity_title: "Actividad reciente", ranking_title: "Top 5 Favoritos",
      col_product: "Producto", col_count: "Cantidad",
      badge_fav: "Favorito", badge_req: "Solicitud", unit: "",
      step1: "Sincronización", desc1: "Compruebe que la sincronización esté activada para comenzar a vender sin problemas.",
      step2: "Configuración email", desc2: "Personalice el texto para crear un mensaje especial que llegue a sus clientes.",
      step3: "Ubicación del botón", desc3: "Muestre el botón de notificación en el producto para no perder ninguna oportunidad.",
      step4: "Crear página", desc4: "Active la lista de favoritos para que los clientes guarden lo que les interesa.",
      step5: "Envío de prueba", desc5: "Envíe un correo de prueba para asegurarse de que las notificaciones lleguen correctamente.",
      step6: "Uso de análisis", desc6: "Analice datos para comprender tendencias y optimizar su inventario. *Plan Pro",
      video_placeholder: "Video de instalación (Próximamente)",
      lang_card_title: "Idioma", lang_card_desc: "Cambiar el idioma a mostrar.", lang_card_btn: "Cambiar",
      app_info: "Info de la app", app_desc: "WishFlow: Visualice la demanda y evite pérdidas.",
      plan_title: "Plan actual", plan_current: "Activo", btn_plan: "Ver / Cambiar Plan",
      feedback_title: "Comentarios y Soporte", feedback_desc: "Ayúdenos a mejorar. Contáctenos si necesita ayuda.", btn_feedback: "Contactar a soporte",
      pro_lock_title: "Desbloquea análisis avanzados con Pro",
      pro_lock_desc: "Visualice qué productos son los más deseados y tienen mayor demanda.",
      btn_upgrade: "Actualizar ahora"
    }
  };

  const text = t[lang] || t.en;
  const reviewUrl = `https://apps.shopify.com/${APP_HANDLE}/reviews?#modal-show=ReviewListingModal`;

  const formatPrice = (price) => {
    const locale = lang === 'ja' ? 'ja-JP' : 'en-US';
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode, maximumFractionDigits: 0 }).format(price);
  };

  const handleAction = (step) => {
    switch(step) {
      case "1": case "2": case "5": navigate("/app/additional"); break;
      case "3": window.open(`https://${shop}/admin/themes/current/editor?context=apps&template=product`, '_blank'); break;
      case "4": window.open(`https://${shop}/admin/themes/current/editor?context=apps`, '_blank'); break;
      // ★ 権限がない場合は料金ページへ誘導
      case "6": navigate(isProUnlocked ? "/app/analysis" : "/app/pricing"); break; 
    }
  };

  const currentPlanName = appUsage?.isFounder 
    ? "Founder" 
    : (appUsage?.plan ? appUsage.plan.charAt(0).toUpperCase() + appUsage.plan.slice(1) : "Free");

  const guideSteps = [
    { step: "1", title: text.step1, desc: text.desc1, image: "/images/step1.png" },
    { step: "2", title: text.step2, desc: text.desc2, image: "/images/step2.png" },
    { step: "3", title: text.step3, desc: text.desc3, image: "/images/step3.png" },
    { step: "4", title: text.step4, desc: text.desc4, image: "/images/step4.png" },
    { step: "5", title: text.step5, desc: text.desc5, image: "/images/step5.png" },
    { step: "6", title: text.step6, desc: text.desc6, image: "/images/step6.png" },
  ];

  return (
    <Page title={text.title}>
      <BlockStack gap="500">
        
        <Banner tone="info" action={{content: text.rev_btn, url: reviewUrl, external: true}}>
          <BlockStack gap="200">
            <Text variant="headingMd" as="h2">{text.rev_title}</Text>
            <Text variant="bodyMd">{text.rev_desc}</Text>
          </BlockStack>
        </Banner>

        {isLoaded && (
          isGuideHidden ? (
            <Card>
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <Icon source={CheckCircleIcon} tone="success" />
                  <Text variant="headingMd">{stepsCompletedCount === 6 ? text.guide_complete_msg : text.guide_title}</Text>
                </InlineStack>
                <Button onClick={showGuide} icon={ShowIcon} variant="tertiary">{text.guide_show}</Button>
              </InlineStack>
            </Card>
          ) : (
            <Card padding="0">
              <Box padding="600">
                <BlockStack gap="500">
                  <InlineStack align="space-between" blockAlign="start" wrap={false}>
                    <Text variant="headingLg" as="h3">{text.guide_title}</Text>
                    <Button variant="tertiary" icon={XIcon} onClick={hideGuide}>{text.guide_hide}</Button>
                  </InlineStack>

                  <InlineGrid columns={{xs: 1, md: "1.4fr 1fr"}} gap="800">
                    <BlockStack gap="400">
                      <Text variant="bodyMd" tone="subdued">{text.guide_desc}</Text>
                      
                      <InlineStack align="start" wrap={false}>
                        <Button icon={NoteIcon} url="https://www.notion.so/WishFlow-Complete-Setup-Guide-31455d445ca68004b972d50017ec5c5b?source=copy_link" target="_blank">{text.guide_manual}</Button>
                      </InlineStack>
                      
                      <BlockStack gap="100">
                        <Text variant="bodySm" tone="subdued">{text.guide_progress.replace("{count}", stepsCompletedCount)}</Text>
                        <ProgressBar progress={(stepsCompletedCount / 6) * 100} size="small" tone="primary" />
                      </BlockStack>
                    </BlockStack>

                    <Box>
  <div style={{
    width: '100%',
    aspectRatio: '16/9',
    borderRadius: '12px',
    overflow: 'hidden',
    border: '1px solid var(--p-color-border-subdued)',
    backgroundColor: '#000'
  }}>
    <iframe 
      width="100%" 
      height="100%" 
      src="https://www.youtube.com/embed/LaHGDLid2CE?rel=0" 
      title="WishFlow Setup & PR Video" 
      frameBorder="0" 
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
      allowFullScreen
      style={{ display: 'block' }}
    ></iframe>
  </div>
</Box>
                  </InlineGrid>
                </BlockStack>
              </Box>
                
              <Divider />

              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {guideSteps.map((item, index) => {
                  const isDone = completedSteps.includes(item.step);
                  const isExpanded = activeStep === item.step;

                  return (
                    <div key={item.step} style={{ 
                      padding: '20px 24px', 
                      backgroundColor: isExpanded ? 'var(--p-color-bg-surface-secondary)' : 'transparent',
                      borderBottom: index !== guideSteps.length - 1 ? '1px solid var(--p-color-border-subdued)' : 'none' 
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', cursor: 'pointer' }} onClick={() => toggleAccordion(item.step)}>
                        <div onClick={(e) => { e.stopPropagation(); toggleStepComplete(item.step); }}
                             style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', borderRadius: '50%', border: isDone ? 'none' : '2px dashed var(--p-color-border-emphasis)', flexShrink: 0 }}>
                          {isDone && <Icon source={CheckCircleIcon} tone="success" />}
                        </div>
                        <Text variant="headingMd" fontWeight={isExpanded ? "bold" : "regular"}>{item.title}</Text>
                      </div>

                      {isExpanded && (
                        <div style={{ paddingLeft: '40px', marginTop: '16px' }}>
                          <InlineStack align="space-between" blockAlign="center" gap="400" wrap={false}>
                            <Box style={{ flex: 1 }}>
                              <BlockStack gap="400">
                                <Text variant="bodyMd">{item.desc}</Text>
                                <InlineStack align="start" wrap={false}>
                                  <Button onClick={() => handleAction(item.step)}>{text.guide_go}</Button>
                                </InlineStack>
                              </BlockStack>
                            </Box>

                            <div style={{ 
                              width: '312px', height: '156px', flexShrink: 0, 
                              borderRadius: '16px', border: '1px solid var(--p-color-border-subdued)', 
                              backgroundColor: 'var(--p-color-bg-surface)', overflow: 'hidden' 
                            }}>
                              <img 
                                src={item.image} 
                                alt="" 
                                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} 
                                onError={(e) => { e.target.src = "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png"; }}
                              />
                            </div>
                          </InlineStack>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )
        )}

        <Layout>
          <Layout.Section>
             <BlockStack gap="500">
                <InlineGrid columns={{xs: 1, sm: 2, md: 2}} gap="400">
                  <MetricCard title={text.kpi_restock} value={restockCount} unit={text.unit} icon={EmailIcon} color="critical" />
                  <MetricCard title={text.kpi_fav} value={totalFavorites} unit={text.unit} icon={CheckCircleIcon} color="success" />
                  <MetricCard title={text.kpi_sales} value={formatPrice(totalRevenue)} icon={MoneyIcon} color="info" />
                  <MetricCard title={text.kpi_cv} value={`${cvRate}%`} icon={ChartVerticalIcon} color="subdued" />
                </InlineGrid>

                {/* ★ 修正：注目のお気に入りカード（権限ロック機能） */}
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '20px', display: 'flex' }}><Icon source={ChartVerticalIcon} tone="base" /></div>
                        <Text variant="headingMd">{text.ranking_title}</Text>
                      </div>
                      
                      {/* ★ 権限がない場合はProバッジを表示 */}
                      <InlineStack gap="200" blockAlign="center">
                        {!isProUnlocked && <Badge tone="info">Pro</Badge>}
                        <Button 
                          variant="plain" 
                          onClick={() => navigate(isProUnlocked ? "/app/analysis" : "/app/pricing")}
                        >
                          {text.btn_analysis}
                        </Button>
                      </InlineStack>
                    </InlineStack>
                    
                    <Divider />
                    
                    {/* ★ 権限がない場合はテーブルをぼかしてバナーを重ねる */}
                    <div style={{ position: 'relative', minHeight: '280px', overflow: 'hidden' }}>
                      <div style={{ 
                        filter: isProUnlocked ? 'none' : 'blur(4px)', 
                        pointerEvents: isProUnlocked ? 'auto' : 'none' 
                      }}>
                        <DataTable
                          columnContentTypes={['text', 'numeric']}
                          headings={[text.col_product, text.col_count]}
                          rows={topFavorites.map(f => [
                            <InlineStack gap="300" blockAlign="center" align="start" wrap={false} key={f.productHandle}>
                              <Thumbnail source={f.imageUrl || ImageIcon} size="small" alt="" />
                              <Text fontWeight="bold">{f.productHandle}</Text>
                            </InlineStack>,
                            f._count.productHandle
                          ])}
                        />
                      </div>

                      {/* ロックオーバーレイバナー */}
                      {!isProUnlocked && (
                        <div style={{ 
                          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, 
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          backgroundColor: 'rgba(255, 255, 255, 0.4)', borderRadius: '8px', zIndex: 1
                        }}>
                          <Box padding="400" shadow="md" background="bg-surface" borderRadius="200" border="1px solid var(--p-color-border-subdued)">
                            <BlockStack gap="200" align="center">
                              <Icon source={LockIcon} tone="subdued" />
                              <Text variant="headingSm" alignment="center">{text.pro_lock_title}</Text>
                              <Text variant="bodySm" tone="subdued" alignment="center">{text.pro_lock_desc}</Text>
                              <Button variant="primary" size="slim" onClick={() => navigate("/app/pricing")}>{text.btn_upgrade}</Button>
                            </BlockStack>
                          </Box>
                        </div>
                      )}
                    </div>

                  </BlockStack>
                </Card>
             </BlockStack>
          </Layout.Section>

          {/* ▼ 右カラム ▼ */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="500">
              
              <Card>
                <BlockStack gap="400">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '20px', display: 'flex' }}><Icon source={ViewIcon} tone="base" /></div>
                    <Text variant="headingMd">{text.activity_title}</Text>
                  </div>
                  
                  <BlockStack gap="0">
                    {activities.map((act, i) => (
                      <div key={i} style={{ 
                        display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0',
                        borderBottom: i !== activities.length - 1 ? '1px solid var(--p-color-border-subdued)' : 'none'
                      }}>
                        <div style={{ flexShrink: 0 }}>
                          <Badge tone={act.type === 'fav' ? 'success' : 'attention'}>
                            {act.type === 'fav' ? text.badge_fav : text.badge_req}
                          </Badge>
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <Text variant="bodyMd" truncate>{act.productHandle}</Text>
                        </div>
                      </div>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '20px', display: 'flex' }}><Icon source={StarIcon} tone="base" /></div>
                      <Text variant="headingMd">{text.plan_title}</Text>
                    </div>
                    <Badge tone={appUsage?.isFounder ? "magic" : (appUsage?.plan === "pro" ? "info" : "new")}>
                      {currentPlanName}
                    </Badge>
                  </InlineStack>
                  <Button fullWidth onClick={() => navigate("/app/pricing")}>{text.btn_plan}</Button>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '20px', display: 'flex' }}><Icon source={GlobeIcon} tone="base" /></div>
                    <Text variant="headingMd">{text.lang_card_title}</Text>
                  </div>
                  <Text variant="bodySm" tone="subdued">{text.lang_card_desc}</Text>
                  <Button fullWidth onClick={() => navigate("/app/additional")}>{text.lang_card_btn}</Button>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '20px', display: 'flex' }}><Icon source={ChatIcon} tone="base" /></div>
                    <Text variant="headingMd">{text.feedback_title}</Text>
                  </div>
                  <Text variant="bodySm" tone="subdued">{text.feedback_desc}</Text>
                  <Button 
                    fullWidth 
                    variant="primary"
                    url="mailto:customer@knotscheme.com?subject=Feedback%20for%20WishFlow"
                    target="_blank"
                  >
                    {text.btn_feedback}
                  </Button>
                </BlockStack>
              </Card>

              <Card>
                <InlineStack align="space-between" blockAlign="center">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '20px', display: 'flex' }}><Icon source={InfoIcon} tone="base" /></div>
                    <Text variant="headingMd">{text.app_info}</Text>
                  </div>
                  <Badge tone="info">v1.2.0</Badge>
                </InlineStack>
                <Box paddingBlockStart="300"><Text variant="bodySm" tone="subdued">{text.app_desc}</Text></Box>
              </Card>

            </BlockStack>
          </Layout.Section>
        </Layout>
        
        <Box paddingBlockEnd="1000" />
      </BlockStack>
    </Page>
  );
}

function MetricCard({ title, value, unit = "", icon, color, action }) {
  return (
    <Card>
      <BlockStack gap="200">
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '20px', display: 'flex' }}>
            <Icon source={icon} tone="subdued" />
          </div>
          <Text variant="headingSm" tone="subdued">{title}</Text>
        </div>
        <Text variant="heading2xl" tone={color} alignment="end">
          {value} <span style={{ fontSize: '14px', fontWeight: 'normal' }}>{unit}</span>
        </Text>
        {action && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
            {action}
          </div>
        )}
      </BlockStack>
    </Card>
  );
}