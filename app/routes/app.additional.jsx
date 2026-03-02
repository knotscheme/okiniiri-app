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

  // ★修正ポイント1: プロモコードの使用済み数をリアルタイムに集計
  const actualUsedCount = await db.promoCode.count({
    where: { isUsed: true }
  });

  let campaign = await db.founderCampaign.findFirst();
  if (!campaign) {
    campaign = await db.founderCampaign.create({
      data: { code: "OFFICIAL_HOLDER", totalSlots: 100, usedSlots: 0, isActive: true }
    });
  }

  return { 
    settings: settings || {}, 
    shop,
    isFounder: appUsage.isFounder,
    currentPlan: appUsage.plan || "free",
    campaign: {
      totalSlots: campaign.totalSlots,
      usedSlots: actualUsedCount, // ★修正ポイント2: DBの集計結果を画面に渡す
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
      founder_full: "Désolé, cetteキャンペーン est complète",
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

  // ★修正ポイント3: プロモコード判定ロジックの刷新
  if (intent === "apply_founder_code") {
    const inputCode = formData.get("founder_code")?.trim();
    if (!inputCode) return { success: false, message: msgs.founder_empty };

    // 1. まずそのコードが「存在する」かつ「未使用」か確認
    const promo = await db.promoCode.findUnique({
      where: { code: inputCode }
    });

    if (!promo || promo.isUsed) {
      return { success: false, message: msgs.founder_invalid };
    }

    try {
      await db.$transaction(async (tx) => {
        // キャンペーン全体の残り枠を再確認（並列実行対策）
        const campaign = await tx.founderCampaign.findFirst();
        const currentUsedCount = await tx.promoCode.count({ where: { isUsed: true } });

        if (!campaign || !campaign.isActive || currentUsedCount >= campaign.totalSlots) {
          throw new Error("FULL");
        }

        const usage = await tx.appUsage.findUnique({ where: { shop: session.shop } });
        if (usage && usage.isFounder) {
          throw new Error("ALREADY");
        }

        // 2. コードを使用済みに更新
        await tx.promoCode.update({
          where: { id: promo.id },
          data: {
            isUsed: true,
            usedBy: session.shop,
            usedAt: new Date(),
          }
        });

        // 3. 表示用カウントを更新
        await tx.founderCampaign.update({
          where: { id: campaign.id },
          data: { usedSlots: { increment: 1 } }
        });

        // 4. ショップのステータスをFounderに更新
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

  // --- これ以降、他のintent（sync, test_email, save等）は一切変更なし ---
  if (intent === "sync") {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { success: true, message: msgs.sync };
  }

  if (intent === "test_email") {
    const targetEmail = formData.get("test_email_to");
    if (!targetEmail) return { success: false, message: msgs.test_error };

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("Error: RESEND_API_KEY is missing in .env");
      return { success: false, message: "System Error: .envにRESEND_API_KEYが設定されていません。" };
    }

    let senderName = "ショップ事務局";
    try {
      const currentSettings = await db.emailSetting.findUnique({ where: { shop: session.shop } });
      if (currentSettings?.senderName) senderName = currentSettings.senderName;
    } catch(e) { console.error("DB Fetch Error in test_email:", e); }

    const mailTemplates = {
      ja: { subject: "【WishFlow】テストメール送信確認", title: "テストメール送信完了", message: "これはWishFlowアプリからのテストメールです。<br>このメールが受信できれば、通知設定は正常に動作しています。", footer: "送信設定" },
      en: { subject: "[WishFlow] Test Email Confirmation", title: "Test Email Sent", message: "This is a test email from the WishFlow app.<br>If you received this, your notification settings are working correctly.", footer: "Sender Settings" },
      zh: { subject: "【WishFlow】測試郵件確認", title: "測試郵件發送完成", message: "這是來自 WishFlow 應用程序的測試郵件。<br>如果您收到此郵件，說明通知設置工作正常。", footer: "發送設置" },
      fr: { subject: "[WishFlow] Confirmation de l'e-mail de test", title: "E-mail de test envoyé", message: "Ceci est un e-mail de test de l'application WishFlow.<br>Si vous recevez ceci, vos paramètres de notification fonctionnent correctement.", footer: "Paramètres d'envoi" },
      de: { subject: "[WishFlow] Test-E-Mail-Bestätigung", title: "Test-E-Mail gesendet", message: "Dies ist eine Test-E-Mail der WishFlow-App.<br>Wenn Sie dies erhalten, funktionieren Ihre Benachrichtigungseinstellungen korrekt.", footer: "Absendereinstellungen" },
      es: { subject: "[WishFlow] Confirmación de correo de prueba", title: "Correo de prueba enviado", message: "Este es un correo de prueba de la application WishFlow.<br>Si recibe esto, su configuración de notificaciones funciona correctamente.", footer: "Configuración de envío" }
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
      if (error) return { success: false, message: `${msgs.test_fail} ${error.message}` };
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
            metafieldsSet(metafields: [$input]) { userErrors { message } }
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
      } catch (e) { console.error("Metafield Update Failed:", e); }
    }
    return { success: true, message: msgs.saved };
  }
};

export default function AdditionalPage() {
  const { settings, isFounder, currentPlan, campaign } = useLoaderData(); 
  const actionData = useActionData();
  const submit = useSubmit();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isLoading = navigation.state === "submitting";
  const loadingIntent = navigation.formData?.get("intent");

  const [founderCode, setFounderCode] = useState("");
  const [showPlanLock, setShowPlanLock] = useState(false);

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
      founder_placeholder: "招待コード (例: WISH-XXXX)",
      btn_founder: "特典を受け取る",
      founder_thanks: "✨ あなたはFounderメンバーです！\n今後のすべてのアップデートやPro機能が永久に無料でご利用いただけます。初期からのご支援、本当にありがとうございます。",
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
      founder_placeholder: "Invite Code (e.g. WISH-XXXX)",
      btn_founder: "Claim Offer",
      founder_thanks: "✨ You are a Founder Member!\nAll future updates and Pro features are forever free. Thank you for your early support!",
      lang_lock_title: "Multi-language support is available on Standard Plan",
      lang_lock_desc: "Free plan supports English and Japanese only. Upgrade to access all 6 languages.",
      btn_view_plans: "View Plans"
    },
    zh: {
      title: "同步与系统设置",
      lang_title: "语言设置", lang_label: "应用语言", lang_help: "更改设置后，请点击下方按钮。", btn_lang: "反映语言设置",
      email_section_title: "邮件通知设置",
      email_sender: "发件人名称", email_sub: "主题", email_body: "正文", btn_email: "保存邮件设置",
      sys_title: "系统状态", sys_on: "运行中", sys_off: "已停止", sys_stop: "停止系统", sys_start: "启动系统",
      sys_banner_on_title: "系统正常运行中",
      sys_banner_on_desc: "到货提醒请求接收和邮件通知已启用。",
      sys_banner_off_title: "系统已停止",
      sys_banner_off_desc: "目前不接收请求，也不发送邮件通知。",
      btn_sync: "手动数据同步", tab_reg: "注册完成邮件", tab_res: "到货通知邮件",
      card_support: "通知测试",
      label_test_email: "测试收件地址",
      placeholder_test_email: "example@email.com",
      btn_test_email: "发送测试", 
      test_help: "向输入的地址发送测试邮件。",
      tmpl_sender: "商店事务局",
      tmpl_reg_sub: "【到货通知注册完成】",
      tmpl_reg_body: "已收到商品「{{product_name}}」的到货通知设置。到货后我们将通过此邮件地址联系您。",
      tmpl_res_sub: "【到货通知】",
      tmpl_res_body: "您注册的商品「{{product_name}}」已到货。",
      card_founder: "100名限定 创始人计划",
      founder_desc: "初期用户的特别计划（Pro功能永久免费）。如果您有邀请码，请输入。",
      founder_badge_active: "创始人成员",
      founder_badge_left: "剩余名额: {left} / {total}",
      founder_placeholder: "邀请码 (例: WISH-XXXX)",
      btn_founder: "领取福利",
      founder_thanks: "✨ 您是创始人成员！\n未来的所有更新和Pro功能都将永久免费。非常感谢您从初期的支持。",
      lang_lock_title: "多语言支持（6国语言）将在标准计划或以上解锁",
      lang_lock_desc: "免费计划仅支持日语和英语。全球业务请考虑标准计划。",
      btn_view_plans: "查看计划"
    },
    fr: {
      title: "Synchronisation et paramètres système",
      lang_title: "Paramètres de langue", lang_label: "Langue de l'application", lang_help: "Après avoir modifié les paramètres, appuyez sur le bouton ci-dessous.", btn_lang: "Appliquer la langue",
      email_section_title: "Paramètres de notification par e-mail",
      email_sender: "Nom de l'expéditeur", email_sub: "Objet", email_body: "Corps", btn_email: "Enregistrer les paramètres e-mail",
      sys_title: "État du système", sys_on: "En cours", sys_off: "Arrêté", sys_stop: "Arrêter le système", sys_start: "Démarrer le système",
      sys_banner_on_title: "Le système fonctionne normalement",
      sys_banner_on_desc: "La réception des demandes de réapprovisionnement et les notifications par e-mail sont activées.",
      sys_banner_off_title: "Le système est arrêté",
      sys_banner_off_desc: "Les demandes et les notifications ne sont pas effectuées pour le moment.",
      btn_sync: "Synchronisation manuelle", tab_reg: "E-mail de confirmation", tab_res: "E-mail de réapprovisionnement",
      card_support: "Test de notification",
      label_test_email: "Adresse e-mail de test",
      placeholder_test_email: "example@email.com",
      btn_test_email: "Envoyer un test", 
      test_help: "Envoie un e-mail de test à l'adresse saisie.",
      tmpl_sender: "Support boutique",
      tmpl_reg_sub: "[Confirmation de réapprovisionnement]",
      tmpl_reg_body: "Nous avons bien reçu votre demande pour {{product_name}}. Nous vous contacterons dès son arrivée.",
      tmpl_res_sub: "[Alerte réapprovisionnement]",
      tmpl_res_body: "Bonne nouvelle ! {{product_name}} est de nouveau en stock.",
      card_founder: "Plan Founder limité à 100",
      founder_desc: "Plan spécial pour les premiers utilisateurs (fonctions Pro gratuites à vie). Entrez votre code d'invitation.",
      founder_badge_active: "Membre Founder",
      founder_badge_left: "{left} / {total} places restantes",
      founder_placeholder: "Code d'invitation (ex: WISH-XXXX)",
      btn_founder: "Profiter de l'offre",
      founder_thanks: "✨ Vous êtes membre Founder !\nToutes les futures mises à jour et fonctions Pro sont gratuites à vie. Merci pour votre soutien !",
      lang_lock_title: "Le support multilingue est disponible à partir du plan Standard",
      lang_lock_desc: "Le plan gratuit ne supporte que le japonais et l'anglais.",
      btn_view_plans: "Voir les plans"
    },
    de: {
      title: "Sync- & Systemeinstellungen",
      lang_title: "Spracheinstellungen", lang_label: "App-Sprache", lang_help: "Klicken Sie nach dem Ändern der Einstellungen auf die Schaltfläche unten.", btn_lang: "Sprache anwenden",
      email_section_title: "E-Mail-Benachrichtigungseinstellungen",
      email_sender: "Absendername", email_sub: "Betreff", email_body: "Inhalt", btn_email: "E-Mail-Einstellungen speichern",
      sys_title: "Systemstatus", sys_on: "Läuft", sys_off: "Gestoppt", sys_stop: "System stoppen", sys_start: "System starten",
      sys_banner_on_title: "System ist betriebsbereit",
      sys_banner_on_desc: "Anfragen und E-Mail-Benachrichtigungen sind aktiv.",
      sys_banner_off_title: "System ist gestoppt",
      sys_banner_off_desc: "Anfragen und Benachrichtigungen sind derzeit pausiert.",
      btn_sync: "Manuelle Datensynchronisierung", tab_reg: "Bestätigungs-E-Mail", tab_res: "Nachschub-E-Mail",
      card_support: "Benachrichtigungstest",
      label_test_email: "Test-E-Mail-Adresse",
      placeholder_test_email: "example@email.com",
      btn_test_email: "Test senden", 
      test_help: "Sendet eine Test-E-Mail an die angegebene Adresse.",
      tmpl_sender: "Shop-Support",
      tmpl_reg_sub: "[Bestätigung] Benachrichtigung für Nachschub",
      tmpl_reg_body: "Wir haben Ihre Anfrage für {{product_name}} erhalten. Wir informieren Sie, sobald es wieder da ist.",
      tmpl_res_sub: "[Nachschub-Alarm] Wieder auf Lager!",
      tmpl_res_body: "Gute Nachrichten! {{product_name}} ist wieder verfügbar.",
      card_founder: "Founder-Plan (limitiert auf 100)",
      founder_desc: "Spezialplan für frühe Nutzer (Pro-Funktionen dauerhaft kostenlos). Geben Sie Ihren Code ein.",
      founder_badge_active: "Founder-Mitglied",
      founder_badge_left: "{left} / {total} Plätze frei",
      founder_placeholder: "Einladungscode (z.B. WISH-XXXX)",
      btn_founder: "Angebot anfordern",
      founder_thanks: "✨ Sie sind Founder-Mitglied!\nAlle Updates und Pro-Funktionen sind dauerhaft kostenlos. Danke für Ihre Unterstützung!",
      lang_lock_title: "Mehrsprachigkeit ist ab dem Standard-Plan verfügbar",
      lang_lock_desc: "Der kostenlose Plan unterstützt nur Japanisch und Englisch.",
      btn_view_plans: "Pläne anzeigen"
    },
    es: {
      title: "Sincronización y ajustes del sistema",
      lang_title: "Ajustes de idioma", lang_label: "Idioma de la aplicación", lang_help: "Tras cambiar los ajustes, pulsa el botón de abajo.", btn_lang: "Aplicar idioma",
      email_section_title: "Ajustes de notificación por correo",
      email_sender: "Nombre del remitente", email_sub: "Asunto", email_body: "Cuerpo", btn_email: "Guardar ajustes de correo",
      sys_title: "Estado del sistema", sys_on: "Activo", sys_off: "Detenido", sys_stop: "Detener sistema", sys_start: "Iniciar sistema",
      sys_banner_on_title: "El sistema funciona normalmente",
      sys_banner_on_desc: "La recepción de solicitudes y notificaciones por correo están activas.",
      sys_banner_off_title: "El sistema está detenido",
      sys_banner_off_desc: "No se procesan solicitudes ni notificaciones en este momento.",
      btn_sync: "Sincronización manual", tab_reg: "Correo de registro", tab_res: "Correo de reposición",
      card_support: "Prueba de notificación",
      label_test_email: "Correo de prueba",
      placeholder_test_email: "example@email.com",
      btn_test_email: "Enviar prueba", 
      test_help: "Envía un correo de prueba a la dirección introducida.",
      tmpl_sender: "Soporte de la tienda",
      tmpl_reg_sub: "[Confirmación] Alerta de reposición",
      tmpl_reg_body: "Hemos recibido tu solicitud para {{product_name}}. Te avisaremos en cuanto llegue.",
      tmpl_res_sub: "[Alerta de reposición] ¡Ya disponible!",
      tmpl_res_body: "¡Buenas noticias! {{product_name}} vuelve a estar en stock.",
      card_founder: "Plan Founder limitado a 100",
      founder_desc: "Plan especial para primeros usuarios (funciones Pro gratis para siempre). Introduce tu código.",
      founder_badge_active: "Miembro Founder",
      founder_badge_left: "{left} / {total} plazas restantes",
      founder_placeholder: "Código de invitación (ej: WISH-XXXX)",
      btn_founder: "Reclamar oferta",
      founder_thanks: "✨ ¡Eres miembro Founder!\nTodas las actualizaciones y funciones Pro son gratis para siempre. ¡Gracias por tu apoyo!",
      lang_lock_title: "El soporte multi-idioma está disponible en el plan Standard",
      lang_lock_desc: "El plan gratuito solo soporta japonés e inglés.",
      btn_view_plans: "Ver planes"
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
    const isFree = !isFounder && currentPlan === "free";
    const isRestrictedLanguage = !["ja", "en"].includes(newLang);
    if (isFree && isRestrictedLanguage) {
      setShowPlanLock(true);
      return;
    }
    setShowPlanLock(false);
    const newText = t[newLang] || t.ja;
    setFormState(prev => ({
      ...prev, language: newLang,
      senderName: newText.tmpl_sender, subject: newText.tmpl_reg_sub, body: newText.tmpl_reg_body,
      restockSubject: newText.tmpl_res_sub, restockBody: newText.tmpl_res_body
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
    if (!testEmail) { alert(text.test_error || "メールアドレスを入力してください"); return; }
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

        {showPlanLock && (
          <Banner tone="warning" title={text.lang_lock_title} action={{ content: text.btn_view_plans, onAction: () => navigate("/app/pricing") }} onDismiss={() => setShowPlanLock(false)}>
            <p>{text.lang_lock_desc}</p>
          </Banner>
        )}

        <Layout>
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

              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" align="start" blockAlign="center">
                      <div style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center' }}>
                        <Icon source={DiscountIcon} tone="magic" />
                      </div>
                      <Text variant="headingMd">{text.card_founder}</Text>
                    </InlineStack>
                    {isFounder && <Badge tone="success">{text.founder_badge_active}</Badge>}
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
                      {/* 残り枠の表示 */}
                      <InlineStack align="end">
                        <Text variant="bodySm" tone="subdued">
                          {text.founder_badge_left.replace('{left}', campaign.totalSlots - campaign.usedSlots).replace('{total}', campaign.totalSlots)}
                        </Text>
                      </InlineStack>
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

            </BlockStack>
          </Layout.Section>

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
                  <Banner tone={formState.isRestockEnabled ? "success" : "warning"} title={formState.isRestockEnabled ? text.sys_banner_on_title : text.sys_banner_off_title}>
                     <p>{formState.isRestockEnabled ? text.sys_banner_on_desc : text.sys_banner_off_desc}</p>
                     <Box paddingBlockStart="300">
                        <Button variant="primary" tone={formState.isRestockEnabled ? "critical" : "success"} onClick={handleToggleSystem} loading={isLoading && loadingIntent === "toggle_system"} icon={formState.isRestockEnabled ? PauseCircleIcon : PlayIcon}>
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
                    <TextField label={text.label_test_email} placeholder={text.placeholder_test_email} value={testEmail} onChange={setTestEmail} autoComplete="email" type="email" />
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