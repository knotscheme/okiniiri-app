import { useLoaderData, useActionData, useSubmit, useNavigation, useNavigate } from "react-router";
import { 
  Page, Layout, Card, Text, BlockStack, InlineStack, Icon, TextField, 
  Button, Banner, Divider, Box, Tabs, Select, Badge 
} from "@shopify/polaris";
import { 
  RefreshIcon, GlobeIcon, EmailIcon, 
  CheckCircleIcon, PlayIcon, PauseCircleIcon, DiscountIcon 
} from "@shopify/polaris-icons";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { Resend } from "resend";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const settings = await db.emailSetting.findUnique({ where: { shop } });
  
  let appUsage = await db.appUsage.findUnique({ where: { shop } });
  if (!appUsage) {
    appUsage = await db.appUsage.create({ data: { shop } });
  }

  let campaign = await db.founderCampaign.findFirst();
  if (!campaign) {
    campaign = await db.founderCampaign.create({
      data: { code: "FOUNDER100", totalSlots: 100, usedSlots: 0, isActive: true }
    });
  }

  return { 
    settings: settings || {}, 
    shop,
    isFounder: appUsage.isFounder,
    currentPlan: appUsage.plan || "free", // ★プラン情報を追加
    campaign: {
      totalSlots: campaign.totalSlots,
      usedSlots: campaign.usedSlots,
      isActive: campaign.isActive
    }
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  
  const language = formData.get("language") || "ja";

  const t_msgs = {
    ja: {
      sync: "同期をリフレッシュしました",
      test_sent: "宛にテストメールを送信しました",
      test_error: "送信先メールアドレスが入力されていません",
      test_fail: "送信エラー: ",
      saved: "設定を保存しました",
      founder_empty: "招待コードを入力してください",
      founder_invalid: "無効な招待コードです",
      founder_full: "申し訳ありません。この招待枠はすでに定員に達しています",
      founder_already_has: "すでにFounderプランが適用されています",
      founder_success: "🎉 Founderプランが適用されました！全機能を永久無料でご利用いただけます。"
    },
    en: {
      sync: "Synchronization refreshed",
      test_sent: "Test email sent to ",
      test_error: "Please enter an email address",
      test_fail: "Sending failed: ",
      saved: "Settings saved",
      founder_empty: "Please enter an invite code",
      founder_invalid: "Invalid code",
      founder_full: "Sorry, this campaign is full",
      founder_already_has: "You already have the Founder plan",
      founder_success: "🎉 Founder plan applied! All features are yours forever for free."
    },
    zh: {
      sync: "同步已刷新",
      test_sent: "測試郵件已發送至 ",
      test_error: "請輸入電子郵件地址",
      test_fail: "發送失敗: ",
      saved: "設置已保存",
      founder_empty: "请输入邀请码",
      founder_invalid: "无效的邀请码",
      founder_full: "抱歉，该活动名额已满",
      founder_already_has: "您已开通创始人计划",
      founder_success: "🎉 创始人计划已应用！所有功能永久免费。"
    },
    fr: {
      sync: "Synchronisation actualisée",
      test_sent: "E-mail de test envoyé à ",
      test_error: "Veuillez entrer une adresse e-mail",
      test_fail: "Échec de l'envoi: ",
      saved: "Paramètres enregistrés",
      founder_empty: "Veuillez entrer un code d'invitation",
      founder_invalid: "Code invalide",
      founder_full: "Désolé, cette campagne est complète",
      founder_already_has: "Vous avez déjà le plan Founder",
      founder_success: "🎉 Plan Founder appliqué ! Toutes les fonctionnalités sont gratuites à vie."
    },
    de: {
      sync: "Synchronisierung aktualisiert",
      test_sent: "Test-E-Mail gesendet an ",
      test_error: "Bitte geben Sie eine E-Mail-Adresse ein",
      test_fail: "Senden fehlgeschlagen: ",
      saved: "Einstellungen gespeichert",
      founder_empty: "Bitte geben Sie einen Einladungscode ein",
      founder_invalid: "Ungültiger Code",
      founder_full: "Entschuldigung, diese Kampagne ist voll",
      founder_already_has: "Sie haben bereits den Founder-Plan",
      founder_success: "🎉 Founder-Plan angewendet! Alle Funktionen sind dauerhaft kostenlos."
    },
    es: {
      sync: "Sincronización actualizada",
      test_sent: "Correo de prueba enviado a ",
      test_error: "Por favor, introduzca una dirección de correo",
      test_fail: "El envío falló: ",
      saved: "Configuración guardada",
      founder_empty: "Por favor, introduzca un código de invitación",
      founder_invalid: "Código inválido",
      founder_full: "Lo sentimos, esta campaña está llena",
      founder_already_has: "Ya tienes el plan Founder",
      founder_success: "🎉 ¡Plan Founder aplicado! Todas las funciones son gratuitas para siempre."
    }
  };
  
  const msgs = t_msgs[language] || t_msgs.ja;

  if (intent === "apply_founder_code") {
    const inputCode = formData.get("founder_code")?.trim();
    if (!inputCode) return { success: false, message: msgs.founder_empty };

    const campaign = await db.founderCampaign.findUnique({ where: { code: inputCode } });
    
    if (!campaign || !campaign.isActive) {
      return { success: false, message: msgs.founder_invalid };
    }

    try {
      await db.$transaction(async (tx) => {
        const currentCamp = await tx.founderCampaign.findUnique({ where: { id: campaign.id } });
        
        if (currentCamp.usedSlots >= currentCamp.totalSlots) {
          throw new Error("FULL");
        }

        const usage = await tx.appUsage.findUnique({ where: { shop: session.shop } });
        
        if (usage && usage.isFounder) {
          throw new Error("ALREADY");
        }

        await tx.founderCampaign.update({
          where: { id: currentCamp.id },
          data: { usedSlots: { increment: 1 } }
        });

        await tx.appUsage.upsert({
          where: { shop: session.shop },
          update: { isFounder: true, plan: "founder", founderRegisteredAt: new Date() },
          create: { shop: session.shop, isFounder: true, plan: "founder", founderRegisteredAt: new Date() }
        });
      });

      return { success: true, message: msgs.founder_success };
    } catch (e) {
      if (e.message === "FULL") return { success: false, message: msgs.founder_full };
      if (e.message === "ALREADY") return { success: false, message: msgs.founder_already_has };
      console.error(e);
      return { success: false, message: "System Error" };
    }
  }

  if (intent === "sync") {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { success: true, message: msgs.sync };
  }

  if (intent === "test_email") {
    const targetEmail = formData.get("test_email_to");

    if (!targetEmail) {
      return { success: false, message: msgs.test_error };
    }

    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
        console.error("Error: RESEND_API_KEY is missing in .env");
        return { success: false, message: "System Error: .envにRESEND_API_KEYが設定されていません。" };
    }

    let senderName = "ショップ事務局";
    try {
      const currentSettings = await db.emailSetting.findUnique({ where: { shop: session.shop } });
      if (currentSettings?.senderName) {
        senderName = currentSettings.senderName;
      }
    } catch(e) {
      console.error("DB Fetch Error in test_email:", e);
    }

    const mailTemplates = {
      ja: {
        subject: "【WishFlow】テストメール送信確認",
        title: "テストメール送信完了",
        message: "これはWishFlowアプリからのテストメールです。<br>このメールが受信できれば、通知設定は正常に動作しています。",
        footer: "送信設定"
      },
      en: {
        subject: "[WishFlow] Test Email Confirmation",
        title: "Test Email Sent",
        message: "This is a test email from the WishFlow app.<br>If you received this, your notification settings are working correctly.",
        footer: "Sender Settings"
      },
      zh: {
        subject: "【WishFlow】測試郵件確認",
        title: "測試郵件發送完成",
        message: "這是來自 WishFlow 應用程序的測試郵件。<br>如果您收到此郵件，說明通知設置工作正常。",
        footer: "發送設置"
      },
      fr: {
        subject: "[WishFlow] Confirmation de l'e-mail de test",
        title: "E-mail de test envoyé",
        message: "Ceci est un e-mail de test de l'application WishFlow.<br>Si vous recevez ceci, vos paramètres de notification fonctionnent correctement.",
        footer: "Paramètres d'envoi"
      },
      de: {
        subject: "[WishFlow] Test-E-Mail-Bestätigung",
        title: "Test-E-Mail gesendet",
        message: "Dies ist eine Test-E-Mail der WishFlow-App.<br>Wenn Sie dies erhalten, funktionieren Ihre Benachrichtigungseinstellungen korrekt.",
        footer: "Absendereinstellungen"
      },
      es: {
        subject: "[WishFlow] Confirmación de correo de prueba",
        title: "Correo de prueba enviado",
        message: "Este es un correo de prueba de la aplicación WishFlow.<br>Si recibe esto, su configuración de notificaciones funciona correctamente.",
        footer: "Configuración de envío"
      }
    };

    const tmpl = mailTemplates[language] || mailTemplates.en;

    try {
      const resend = new Resend(apiKey);
      
      const { data, error } = await resend.emails.send({
        from: `${senderName} <in_stock@knotscheme.com>`, 
        to: targetEmail,
        subject: tmpl.subject,
        html: `
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2>${tmpl.title}</h2>
            <p>${tmpl.message}</p>
            <hr>
            <p style="font-size: 12px; color: #888;">${tmpl.footer}: ${senderName} &lt;in_stock@knotscheme.com&gt;</p>
            <p style="font-size: 12px; color: #888;">Time: ${new Date().toLocaleString()}</p>
          </div>
        `
      });

      if (error) {
        console.error("Resend API returned error:", error);
        return { success: false, message: `${msgs.test_fail} ${error.message}` };
      }

      return { success: true, message: `${msgs.test_sent}${targetEmail}` };
      
    } catch (e) {
      console.error("Resend Exception:", e);
      return { success: false, message: `${msgs.test_fail} ${e.message}` };
    }
  }

  if (intent === "save_language" || intent === "save_email" || intent === "toggle_system") {
    const senderName = formData.get("senderName");
    const subject = formData.get("subject");
    const body = formData.get("body");
    const restockSubject = formData.get("restockSubject");
    const restockBody = formData.get("restockBody");
    
    const existingSettings = await db.emailSetting.findUnique({ where: { shop: session.shop } });
    const isRestockEnabled = formData.has("isRestockEnabled") 
      ? formData.get("isRestockEnabled") === "true" 
      : (existingSettings?.isRestockEnabled ?? true);

    await db.emailSetting.upsert({
      where: { shop: session.shop },
      update: { senderName, subject, body, restockSubject, restockBody, isRestockEnabled, language },
      create: { shop: session.shop, senderName, subject, body, restockSubject, restockBody, isRestockEnabled, language },
    });

    if (intent === "save_language") {
      try {
        const shopDataRes = await admin.graphql(`{ shop { id } }`);
        const shopJson = await shopDataRes.json();
        const shopId = shopJson.data.shop.id;

        await admin.graphql(
          `mutation setMetafield($input: MetafieldsSetInput!) {
            metafieldsSet(metafields: [$input]) {
              userErrors { message }
            }
          }`,
          {
            variables: {
              input: {
                namespace: "wishflow_settings",
                key: "language",
                ownerId: shopId,
                type: "single_line_text_field",
                value: String(language)
              }
            }
          }
        );
      } catch (e) {
        console.error("Metafield Update Failed:", e);
      }
    }
    return { success: true, message: msgs.saved };
  }
};

export default function AdditionalPage() {
  const { settings, isFounder, currentPlan, campaign } = useLoaderData(); 
  const actionData = useActionData();
  const submit = useSubmit();
  const navigate = useNavigate(); // ★追加
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";
  const loadingIntent = navigation.formData?.get("intent");

  const [founderCode, setFounderCode] = useState("");
  const [showPlanLock, setShowPlanLock] = useState(false); // ★言語制限用ステート

  const t = {
    ja: {
      title: "同期とシステム設定",
      lang_title: "言語設定", lang_label: "アプリの表示言語 / App Language", lang_help: "設定を変更した後、下のボタンを押してください。", btn_lang: "言語設定を反映する",
      email_section_title: "メール通知設定",
      email_sender: "送信者名", email_sub: "件名", email_body: "本文", btn_email: "メール設定を保存",
      sys_title: "システム稼働", sys_on: "稼働中", sys_off: "停止中", sys_stop: "システムを停止する", sys_start: "システムを開始する",
      sys_banner_on_title: "システムは正常に稼働しています",
      sys_banner_on_desc: "再入荷リクエストの受付とメール通知が有効になっています。",
      sys_banner_off_title: "システムは停止しています",
      sys_banner_off_desc: "リクエスト受付とメール通知は現在行われません。",
      
      btn_sync: "手動データ同期", tab_reg: "登録完了メール", tab_res: "再入荷通知メール",
      card_support: "通知テスト",
      label_test_email: "送信先メールアドレス",
      placeholder_test_email: "example@email.com",
      btn_test_email: "テスト送信", 
      test_help: "入力したアドレスにテストメールを送信します。",
      tmpl_sender: "ショップ事務局",
      tmpl_reg_sub: "【再入荷通知登録完了】",
      tmpl_reg_body: "商品「{{product_name}}」の入荷通知設定を承りました。入荷次第、本メールアドレスへご連絡いたします。",
      tmpl_res_sub: "【再入荷のお知らせ】",
      tmpl_res_body: "ご登録いただいた商品「{{product_name}}」が再入荷いたしました。",

      card_founder: "100名限定 Founderプラン",
      founder_desc: "初期導入ユーザー様への特別プラン（Pro機能が永久無料）。招待コードをお持ちの場合は入力してください。",
      founder_badge_active: "Founder メンバー",
      founder_badge_left: "残り枠: {left} / {total}",
      founder_placeholder: "招待コード (例: XX-XXXX-XXXX)",
      btn_founder: "特典を受け取る",
      founder_thanks: "✨ あなたはFounderメンバーです！\n今後のすべてのアップデートやPro機能が永久に無料でご利用いただけます。初期からのご支援、本当にありがとうございます。",
      // ★追加テキスト
      lang_lock_title: "多言語対応（6カ国語）はStandardプラン以上で解放されます",
      lang_lock_desc: "Freeプランでは日本語と英語のみご利用いただけます。グローバル展開にはStandardプランをご検討ください。",
      btn_view_plans: "プランを見る"
    },
    en: {
      title: "Sync & System Settings",
      lang_title: "Language Settings", lang_label: "App Language", lang_help: "Click the button below after changing settings.", btn_lang: "Apply Language",
      email_section_title: "Email Notification Settings",
      email_sender: "Sender Name", email_sub: "Subject", email_body: "Body", btn_email: "Save Email Settings",
      sys_title: "System Status", sys_on: "Running", sys_off: "Stopped", sys_stop: "Stop System", sys_start: "Start System",
      sys_banner_on_title: "System is Operational",
      sys_banner_on_desc: "Restock requests and email notifications are active.",
      sys_banner_off_title: "System is Stopped",
      sys_banner_off_desc: "Requests and notifications are currently paused.",

      btn_sync: "Manual Data Sync", tab_reg: "Registration Email", tab_res: "Restock Email",
      card_support: "Notification Test",
      label_test_email: "Test Email Address",
      placeholder_test_email: "example@email.com",
      btn_test_email: "Send Test", 
      test_help: "Send a test email to the address above.",
      tmpl_sender: "Shop Support",
      tmpl_reg_sub: "[Subscription Confirmed] Restock Alert",
      tmpl_reg_body: "We received your request for {{product_name}}. We will notify you when it is back in stock.",
      tmpl_res_sub: "[Restock Alert] Item is back!",
      tmpl_res_body: "Great news! {{product_name}} is now back in stock.",

      card_founder: "First 100 Founder Plan",
      founder_desc: "Special plan for early adopters (Pro features forever free). Enter your invite code.",
      founder_badge_active: "Founder Member",
      founder_badge_left: "{left} / {total} spots left",
      founder_placeholder: "Invite Code (e.g. XX-XXXX-XXXX)",
      btn_founder: "Claim Offer",
      founder_thanks: "✨ You are a Founder Member!\nAll future updates and Pro features are forever free. Thank you for your early support!",
      lang_lock_title: "Multi-language support is available on Standard Plan",
      lang_lock_desc: "Free plan supports English and Japanese only. Upgrade to access all 6 languages.",
      btn_view_plans: "View Plans"
    }
  };

  const [formState, setFormState] = useState({
    senderName: settings.senderName || t.en.tmpl_sender,
  subject: settings.subject || t.en.tmpl_reg_sub,
  body: settings.body || t.en.tmpl_reg_body,
  restockSubject: settings.restockSubject || t.en.tmpl_res_sub,
  restockBody: settings.restockBody || t.en.tmpl_res_body,
  isRestockEnabled: settings.isRestockEnabled ?? true,
  language: settings.language || "en", 
});

  const [testEmail, setTestEmail] = useState("");

  const text = t[formState.language] || t.ja; 

  const handleLanguageChange = (newLang) => {
    // ★ 言語制限ロジック追加
    const isFree = !isFounder && currentPlan === "free";
    const isRestrictedLanguage = !["ja", "en"].includes(newLang);

    if (isFree && isRestrictedLanguage) {
      setShowPlanLock(true); // 警告バナーを表示
      return; // 更新をブロック
    }

    setShowPlanLock(false);
    const newText = t[newLang] || t.ja;
    setFormState(prev => ({
      ...prev,
      language: newLang,
      senderName: newText.tmpl_sender,
      subject: newText.tmpl_reg_sub,
      body: newText.tmpl_reg_body,
      restockSubject: newText.tmpl_res_sub,
      restockBody: newText.tmpl_res_body
    }));
  };

  const handleSaveLanguage = () => {
    const fd = new FormData();
    Object.entries(formState).forEach(([key, value]) => fd.append(key, value));
    fd.append("intent", "save_language");
    submit(fd, { method: "post" });
  };

  const handleSaveEmail = () => {
    const fd = new FormData();
    Object.entries(formState).forEach(([key, value]) => fd.append(key, value));
    fd.append("intent", "save_email");
    submit(fd, { method: "post" });
  };

  const handleTestEmail = () => {
    if (!testEmail) {
        alert(text.test_error || "メールアドレスを入力してください"); 
        return;
    }
    const fd = new FormData();
    fd.append("intent", "test_email");
    fd.append("test_email_to", testEmail);
    fd.append("language", formState.language);
    submit(fd, { method: "post" });
  };

  const handleSync = () => {
    const fd = new FormData();
    fd.append("intent", "sync");
    fd.append("language", formState.language);
    submit(fd, { method: "post" });
  };

  const handleToggleSystem = () => {
    const next = !formState.isRestockEnabled;
    setFormState({ ...formState, isRestockEnabled: next });
    const fd = new FormData();
    Object.entries({ ...formState, isRestockEnabled: next }).forEach(([k, v]) => fd.append(k, v));
    fd.append("intent", "toggle_system");
    submit(fd, { method: "post" });
  };

  const handleApplyFounder = () => {
    if (!founderCode) return;
    const fd = new FormData();
    fd.append("intent", "apply_founder_code");
    fd.append("founder_code", founderCode);
    fd.append("language", formState.language);
    submit(fd, { method: "post" });
  };

  const tabs = [{ id: 'reg', content: text.tab_reg }, { id: 'res', content: text.tab_res }];
  const [selectedTab, setSelectedTab] = useState(0);

  return (
    <Page title={text.title} backAction={{ content: 'Home', onAction: () => window.history.back() }}>
      <BlockStack gap="500">
        {actionData?.success && <Banner tone="success" title={actionData.message} />}
        {actionData?.success === false && <Banner tone="critical" title={actionData.message} />}

        {/* ★追加：言語制限警告バナー */}
        {showPlanLock && (
          <Banner 
            tone="warning" 
            title={text.lang_lock_title}
            action={{ content: text.btn_view_plans, onAction: () => navigate("/app/pricing") }}
            onDismiss={() => setShowPlanLock(false)}
          >
            <p>{text.lang_lock_desc}</p>
          </Banner>
        )}

        <Layout>
          {/* 左カラム：言語設定、メール設定 ＆ Founderキャンペーン */}
          <Layout.Section>
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" align="start" blockAlign="center">
                    <div style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center' }}>
                      <Icon source={GlobeIcon} tone="base" />
                    </div>
                    <Text variant="headingMd">{text.lang_title}</Text>
                  </InlineStack>
                  <Divider />
                  <Select
                    label={text.lang_label}
                    options={[
                      { label: '日本語', value: 'ja' },
                      { label: 'English', value: 'en' },
                      { label: '简体中文', value: 'zh' },
                      { label: 'Français', value: 'fr' },
                      { label: 'Deutsch', value: 'de' },
                      { label: 'Español', value: 'es' },
                    ]}
                    value={formState.language}
                    onChange={handleLanguageChange} 
                    helpText={text.lang_help}
                  />
                  <InlineStack align="end">
                    <Button variant="secondary" onClick={handleSaveLanguage} loading={isLoading && loadingIntent === "save_language"}>
                      {text.btn_lang}
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>

              {/* メール設定カード */}
              <Card padding="0">
                 <Box padding="400">
                    <BlockStack gap="400">
                        <InlineStack gap="200" align="start" blockAlign="center">
                            <div style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center' }}>
                            <Icon source={EmailIcon} tone="base" />
                            </div>
                            <Text variant="headingMd">{text.email_section_title}</Text>
                        </InlineStack>
                        <Divider />
                    </BlockStack>
                 </Box>

                <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
                  <Box padding="400" paddingBlockStart="200">
                    <BlockStack gap="400">
                      <TextField label={text.email_sender} value={formState.senderName} onChange={v => setFormState({...formState, senderName: v})} autoComplete="off" />
                      {selectedTab === 0 ? (
                        <>
                          <TextField label={text.email_sub} value={formState.subject} onChange={v => setFormState({...formState, subject: v})} autoComplete="off" />
                          <TextField label={text.email_body} value={formState.body} onChange={v => setFormState({...formState, body: v})} multiline={4} />
                        </>
                      ) : (
                        <>
                          <TextField label={text.email_sub} value={formState.restockSubject} onChange={v => setFormState({...formState, restockSubject: v})} autoComplete="off" />
                          <TextField label={text.email_body} value={formState.restockBody} onChange={v => setFormState({...formState, restockBody: v})} multiline={4} />
                        </>
                      )}
                      <InlineStack align="end">
                        <Button variant="primary" onClick={handleSaveEmail} loading={isLoading && loadingIntent === "save_email"}>
                          {text.btn_email}
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Box>
                </Tabs>
              </Card>

              {/* Founder キャンペーンカード */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" align="start" blockAlign="center">
                      <div style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center' }}>
                        <Icon source={DiscountIcon} tone="magic" />
                      </div>
                      <Text variant="headingMd">{text.card_founder}</Text>
                    </InlineStack>
{isFounder && (
  <Badge tone="success">{text.founder_badge_active}</Badge>
)}
                  </InlineStack>
                  <Divider />

                  {isFounder ? (
                    <Banner tone="success" title={text.founder_thanks.split('\n')[0]}>
                      <p>{text.founder_thanks.split('\n')[1]}</p>
                    </Banner>
                  ) : (
                    <BlockStack gap="300">
                      <Text variant="bodyMd" tone="subdued">{text.founder_desc}</Text>
                      <InlineStack gap="200" blockAlign="center" wrap={false}>
                        <div style={{ flex: 1 }}>
                          <TextField 
                            placeholder={text.founder_placeholder}
                            value={founderCode}
                            onChange={setFounderCode}
                            autoComplete="off"
                          />
                        </div>
                        <Button 
                          variant="primary" 
                          onClick={handleApplyFounder} 
                          loading={isLoading && loadingIntent === "apply_founder_code"}
                        >
                          {text.btn_founder}
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

            </BlockStack>
          </Layout.Section>

          {/* 右カラム：システム & テスト */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" align="start" blockAlign="center">
                        <div style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center' }}>
                        <Icon source={RefreshIcon} tone="base" />
                        </div>
                        <Text variant="headingMd">{text.sys_title}</Text>
                    </InlineStack>
                    <Badge tone={formState.isRestockEnabled ? "success" : "critical"}>
                        {formState.isRestockEnabled ? text.sys_on : text.sys_off}
                    </Badge>
                  </InlineStack>
                  <Divider />

                  <Banner 
                     tone={formState.isRestockEnabled ? "success" : "warning"}
                     title={formState.isRestockEnabled ? text.sys_banner_on_title : text.sys_banner_off_title}
                  >
                     <p>{formState.isRestockEnabled ? text.sys_banner_on_desc : text.sys_banner_off_desc}</p>
                     <Box paddingBlockStart="300">
                        <Button 
                            variant="primary" 
                            tone={formState.isRestockEnabled ? "critical" : "success"}
                            onClick={handleToggleSystem} 
                            loading={isLoading && loadingIntent === "toggle_system"}
                            icon={formState.isRestockEnabled ? PauseCircleIcon : PlayIcon}
                        >
                            {formState.isRestockEnabled ? text.sys_stop : text.sys_start}
                        </Button>
                     </Box>
                  </Banner>

                  <Box paddingBlockStart="200">
                    <Button fullWidth onClick={handleSync} loading={isLoading && loadingIntent === "sync"}>
                      {text.btn_sync}
                    </Button>
                  </Box>
                </BlockStack>
              </Card>

              {/* テストメール機能 */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" align="start" blockAlign="center">
                    <div style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center' }}>
                      <Icon source={CheckCircleIcon} tone="base" />
                    </div>
                    <Text variant="headingMd">{text.card_support}</Text>
                  </InlineStack>
                  <Divider />
                  
                  <BlockStack gap="200">
                    <TextField 
                        label={text.label_test_email}
                        placeholder={text.placeholder_test_email}
                        value={testEmail}
                        onChange={setTestEmail}
                        autoComplete="email"
                        type="email"
                    />
                    <Button icon={EmailIcon} fullWidth onClick={handleTestEmail} loading={isLoading && loadingIntent === "test_email"}>
                      {text.btn_test_email}
                    </Button>
                    <Text variant="bodySm" tone="subdued">{text.test_help}</Text>
                  </BlockStack>

                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
      <Box paddingBlockEnd="1000" />
    </Page>
  );
}