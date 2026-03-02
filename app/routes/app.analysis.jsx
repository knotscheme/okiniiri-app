import { useLoaderData, useSubmit, useNavigation, redirect } from "react-router";
import { 
  Page, Layout, Card, DataTable, Text, BlockStack, InlineStack, 
  Select, Button, Box, Thumbnail, Divider, InlineGrid, Icon, Badge, 
  Modal, Checkbox, Popover, DatePicker, Spinner, Banner
} from "@shopify/polaris";
import { 
  ExportIcon, ImageIcon, LinkIcon, CalendarIcon, 
  HeartIcon, EmailIcon, OrderIcon, MoneyIcon, PersonIcon
} from '@shopify/polaris-icons';
import { 
  ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend 
} from 'recharts';
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { useState, useCallback, useEffect } from "react";

// ------------------------------------------------------------------
// サーバーサイド処理 (Loader)
// ------------------------------------------------------------------
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  
  // ==========================================
  // 入館チェック（権限チェック）
  // ==========================================
  let appUsage = await db.appUsage.findUnique({ where: { shop } });
  if (!appUsage) {
    appUsage = await db.appUsage.create({ data: { shop } });
  }

  const isProUnlocked = appUsage.isFounder || appUsage.plan === "pro";
  if (!isProUnlocked) {
    return redirect("/app/pricing");
  }

  // 言語設定取得
  const settings = await db.emailSetting.findUnique({ where: { shop } });
  const lang = settings?.language || 'en';

  const dict = {
    ja: { notified: "通知済み", pending: "未通知", purchased: "購入済み", not_purchased: "未購入", direct: "直接流入 / 不明", organic: "オーガニック検索", other: "その他", none: "指定なし" },
    en: { notified: "Notified", pending: "Pending", purchased: "Purchased", not_purchased: "Not Purchased", direct: "Direct / Unknown", organic: "Organic Search", other: "Others", none: "None" },
    zh: { notified: "已通知", pending: "未通知", purchased: "已購買", not_purchased: "未購買", direct: "直接訪問 / 未知", organic: "自然搜尋", other: "其他", none: "無" },
    fr: { notified: "Notifié", pending: "En attente", purchased: "Acheté", not_purchased: "Non acheté", direct: "Direct / Inconnu", organic: "Recherche organique", other: "Autres", none: "Aucun" },
    de: { notified: "Benachrichtigt", pending: "Ausstehend", purchased: "Gekauft", not_purchased: "Nicht gekauft", direct: "Direkt / Unbekannt", organic: "Organische Suche", other: "Andere", none: "Keine" },
    es: { notified: "Notificado", pending: "Pendiente", purchased: "Comprado", not_purchased: "No comprado", direct: "Directo / Desconocido", organic: "Búsqueda orgánica", other: "Otros", none: "Ninguno" },
  };
  const txt = dict[lang] || dict.en;

  // パラメータ取得
  const period = url.searchParams.get("period") || "7";
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  
  let dateFilter = {};
  let graphStartDate = new Date();
  let graphEndDate = new Date();
  const today = new Date();
  
  if (period === "custom" && startParam && endParam) {
    const startDate = new Date(startParam);
    const endDate = new Date(endParam);
    startDate.setUTCHours(0, 0, 0, 0);
    endDate.setUTCHours(23, 59, 59, 999);
    dateFilter = { createdAt: { gte: startDate, lte: endDate } };
    graphStartDate = new Date(startDate);
    graphEndDate = new Date(endDate);
  } else if (period !== "all" && period !== "custom") {
    const days = parseInt(period);
    const startDate = new Date();
    startDate.setDate(today.getDate() - days + 1); 
    startDate.setHours(0, 0, 0, 0);
    dateFilter = { createdAt: { gte: startDate } };
    graphStartDate = new Date(startDate);
    graphEndDate = new Date(today);
  } else {
    graphStartDate.setDate(today.getDate() - 30); 
    graphEndDate = new Date(today);
  }

  const favRaw = await db.favorite.findMany({ where: { shop, ...dateFilter }, orderBy: { createdAt: 'desc' } });
  const restockRaw = await db.restockRequest.findMany({ where: { shop, ...dateFilter }, orderBy: { createdAt: 'desc' } });

  if (period === "all") {
    let oldestDate = new Date();
    if (favRaw.length > 0) {
      const lastFav = new Date(favRaw[favRaw.length - 1].createdAt);
      if (lastFav < oldestDate) oldestDate = lastFav;
    }
    if (restockRaw.length > 0) {
      const lastRestock = new Date(restockRaw[restockRaw.length - 1].createdAt);
      if (lastRestock < oldestDate) oldestDate = lastRestock;
    }
    graphStartDate = oldestDate;
  }

  const totalFavs = favRaw.length;
  const totalRestocks = restockRaw.length;
  const totalConversions = restockRaw.filter(r => r.isConverted).length;
  const conversionRate = totalRestocks > 0 ? ((totalConversions / totalRestocks) * 100).toFixed(1) : "0.0";
  
  let summary = { totalFavs, totalRestocks, totalConversions, conversionRate };

  const allHandles = Array.from(new Set([...favRaw.map(s => s.productHandle), ...restockRaw.map(s => s.productHandle)]));
  const rawCustomerIds = Array.from(new Set(favRaw.map(f => f.customerId).filter(id => id)));

  let productMetaMap = {}; 
  let variantSkuMap = {};  
  let customerMap = {};
  let permissionError = false; 

  if (allHandles.length > 0) {
    try {
      const queryStr = allHandles.slice(0, 50).map(h => `handle:${h}`).join(" OR "); 
      if (queryStr) {
        const response = await admin.graphql(`
          query getProducts($query: String!) { 
            products(first: 50, query: $query) { 
              edges { node { handle title featuredImage { url } variants(first: 50) { edges { node { id sku } } } } } 
            } 
          }`, { variables: { query: queryStr } }
        );
        const resJson = await response.json();
        if (resJson.data?.products?.edges) {
          resJson.data.products.edges.forEach(({ node }) => { 
            productMetaMap[node.handle] = { title: node.title, imageUrl: node.featuredImage?.url || "" }; 
            if (node.variants?.edges) {
              node.variants.edges.forEach(({ node: variant }) => {
                const numericId = variant.id.split('/').pop();
                variantSkuMap[numericId] = variant.sku || ""; 
              });
            }
          });
        }
      }
    } catch (e) { console.error(e); }
  }

  if (rawCustomerIds.length > 0) {
    try {
      const targetIds = rawCustomerIds.slice(0, 50).map(id => `gid://shopify/Customer/${id}`);
      const response = await admin.graphql(`
        query getCustomers($ids: [ID!]!) {
          nodes(ids: $ids) { ... on Customer { id firstName lastName email } }
        }
      `, { variables: { ids: targetIds } });
      const resJson = await response.json();
      if (resJson.errors) {
        permissionError = true;
      } else if (resJson.data?.nodes) {
        resJson.data.nodes.forEach(node => {
          if (node && node.id) {
            const numericId = node.id.split('/').pop();
            const fullName = `${node.lastName || ''} ${node.firstName || ''}`.trim();
            customerMap[numericId] = { name: fullName || "Restricted", email: node.email || "Restricted" };
          }
        });
      }
    } catch (e) { permissionError = true; }
  }

  // 🌟 ここに全プラットフォームの判定が集結
  const getSourceCategory = (referrer) => {
    if (!referrer) return txt.direct;
    const ref = referrer.toLowerCase();
    
    if (ref.includes('line')) return 'LINE';
    if (ref.includes('ig') || ref.includes('instagram')) return 'Instagram';
    if (ref.includes('twitter.com') || ref.includes('t.co') || ref.includes('x.com')) return 'X (Twitter)';
    if (ref.includes('pinterest') || ref.includes('pin.it')) return 'Pinterest';
    if (ref.includes('tiktok')) return 'TikTok';
    if (ref.includes('youtube') || ref.includes('youtu.be')) return 'YouTube';
    
    if (ref.includes('facebook') || ref.includes('fb.')) return 'Facebook';
    if (ref.includes('google.')) return 'Google';
    if (ref.includes('yahoo.') || ref.includes('bing.')) return txt.organic;
    
    return txt.other;
  };

  // サーバーでは時間を加工せず、そのままのデータをフロントに投げる
  const formatDateTime = (dObj) => {
    if (!dObj) return "";
    return new Date(dObj).toISOString(); 
  };

  const rawDetailedData = [
    ...favRaw.map(f => {
      const customerInfo = customerMap[f.customerId] || { name: "", email: "" };
      return { 
        id: f.id,
        date: formatDateTime(f.createdAt), timestamp: new Date(f.createdAt).getTime(), type: 'Fav', 
        handle: f.productHandle, name: productMetaMap[f.productHandle]?.title || f.productHandle, referrer: f.referrer, category: getSourceCategory(f.referrer), 
        userId: f.customerId || "", userName: customerInfo.name, userEmail: customerInfo.email,
        variantId: "-", sku: "-", 
        isNotified: "-", 
        isConverted: "-", convertedAt: "-", convertedPrice: "-"
      };
    }),
    ...restockRaw.map(r => ({ 
      id: r.id,
      date: formatDateTime(r.createdAt), timestamp: new Date(r.createdAt).getTime(), type: 'Restock', 
      handle: r.productHandle, name: productMetaMap[r.productHandle]?.title || r.productHandle, referrer: r.referrer, category: getSourceCategory(r.referrer), 
      userId: "", userName: "", userEmail: r.customerEmail,
      variantId: r.variantId || txt.none, sku: variantSkuMap[r.variantId] || "", 
      isNotified: r.isNotified ? txt.notified : txt.pending,
      isConverted: r.isConverted ? txt.purchased : txt.not_purchased, 
      convertedAt: r.convertedAt ? formatDateTime(r.convertedAt) : "",
      convertedPrice: r.convertedPrice ? r.convertedPrice : ""
    }))
  ].sort((a, b) => b.timestamp - a.timestamp);

  const dailyData = {};
  let loopDate = new Date(graphStartDate);
  while (loopDate <= graphEndDate) {
    const key = loopDate.toISOString().split('T')[0];
    dailyData[key] = { date: key, val1: 0, val2: 0, val3: 0 };
    loopDate.setDate(loopDate.getDate() + 1);
  }

  favRaw.forEach(f => { 
    const d = new Date(f.createdAt).toISOString().split('T')[0]; 
    if (dailyData[d]) dailyData[d].val1++; 
    else dailyData[d] = { date: d, val1: 1, val2: 0, val3: 0 };
  });
  
  restockRaw.forEach(r => { 
    const d = new Date(r.createdAt).toISOString().split('T')[0]; 
    if (!dailyData[d]) dailyData[d] = { date: d, val1: 0, val2: 0, val3: 0 };
    dailyData[d].val2++; 
    if (r.isConverted) dailyData[d].val3++; 
  });

  const sourceMap = {};
  rawDetailedData.forEach(d => {
    if (!sourceMap[d.category]) sourceMap[d.category] = { name: d.category, total: 0, uniqueUsers: new Set(), favs: 0, restocks: 0, conversions: 0 };
    sourceMap[d.category].total++;
    const uniqueKey = d.userId || d.userEmail;
    if (uniqueKey) sourceMap[d.category].uniqueUsers.add(uniqueKey);
    if (d.type === 'Fav') sourceMap[d.category].favs++;
    else { sourceMap[d.category].restocks++; if (d.isConverted === txt.purchased) sourceMap[d.category].conversions++; }
  });

  const sourceData = Object.values(sourceMap).map(s => ({ name: s.name, total: s.total, unique: s.uniqueUsers.size, favs: s.favs, restocks: s.restocks, conversions: s.conversions })).sort((a, b) => b.total - a.total);

  // ==========================================
  // 下段4枚のカード用 KPI計算（見込売上版）
  // ==========================================
  const totalUniqueUsers = new Set(rawDetailedData.map(d => d.userId || d.userEmail).filter(Boolean)).size;
  const totalRevenue = restockRaw.filter(r => r.isConverted).reduce((sum, r) => sum + (parseFloat(r.convertedPrice) || 0), 0);
  const aov = totalConversions > 0 ? Math.round(totalRevenue / totalConversions) : 0;
  
  const pendingRestocks = totalRestocks - totalConversions;
  const potentialRevenue = pendingRestocks * aov;
  
  summary = { ...summary, totalUniqueUsers, totalRevenue, aov, potentialRevenue };

  const groupStats = (items, type) => {
    const map = {};
    items.forEach(i => {
      const h = i.productHandle;
      if (!map[h]) map[h] = { handle: h, count: 0, converted: 0 };
      map[h].count++;
      if (type === 'restock' && i.isConverted) map[h].converted++;
    });
    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 5).map(s => ({ handle: s.handle, name: productMetaMap[s.handle]?.title || s.handle, image: productMetaMap[s.handle]?.imageUrl || "", count: s.count, converted: s.converted }));
  };

  const favData = groupStats(favRaw, 'fav');
  const restockData = groupStats(restockRaw, 'restock');
  const trendData = Object.values(dailyData).sort((a, b) => a.date.localeCompare(b.date));

  return { summary, favData, restockData, trendData, rawDetailedData, sourceData, period, startParam, endParam, lang, permissionError };
};

// ------------------------------------------------------------------
// フロントエンド (UI)
// ------------------------------------------------------------------
export default function AnalysisPage() {
  const { summary, favData, restockData, trendData, rawDetailedData, sourceData, period, startParam, endParam, lang, permissionError } = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading" || navigation.state === "submitting";
  const [currentPeriod, setCurrentPeriod] = useState(period);
  useEffect(() => { setCurrentPeriod(period); }, [period]);

  // 🌟 全SNSのカラー設定
  const SOURCE_COLORS = { 
    'Instagram': '#E1306C', 
    'LINE': '#00C300', 
    'X (Twitter)': '#000000',
    'Pinterest': '#E60023',
    'TikTok': '#FE2C55',
    'YouTube': '#FF0000',
    'Google': '#4285F4', 
    'Facebook': '#1877F2', 
    'オーガニック検索': '#FBC02D', 'Organic Search': '#FBC02D', '自然搜尋': '#FBC02D', 'Recherche organique': '#FBC02D', 'Organische Suche': '#FBC02D', 'Búsqueda orgánica': '#FBC02D',
    '直接流入 / 不明': '#5C5F62', 'Direct / Unknown': '#5C5F62', '直接訪問 / 未知': '#5C5F62', 'Direct / Inconnu': '#5C5F62', 'Direkt / Unbekannt': '#5C5F62', 'Directo / Desconocido': '#5C5F62',
    'その他': '#8A8D91', 'Others': '#8A8D91', '其他': '#8A8D91', 'Autres': '#8A8D91', 'Andere': '#8A8D91', 'Otros': '#8A8D91' 
  };

  const t = {
    ja: {
      title: "統合分析ダッシュボード",
      period_label: "集計期間", p_7: "過去7日間", p_30: "過去30日間", p_all: "全期間", p_custom: "カスタム期間...",
      btn_date: "日付を選択", btn_apply: "適用する", btn_export: "CSVエクスポート", display: "表示中",
      kpi_fav: "累計お気に入り数", kpi_restock: "入荷通知登録数", kpi_cv_count: "復活した注文 (CV)", kpi_cv_rate: "コンバージョン率",
      kpi_users: "利用ユーザー数", kpi_potential_rev: "見込売上", kpi_aov: "平均客単価", kpi_revenue: "アプリ経由の売上",
      tab_source: "流入元（リファラー）分析", tab_trend: "需要と成果のトレンド",
      source_name: "流入元", source_total: "総件数", source_fav: "お気に入り", source_restock: "入荷通知", source_cv: "購入(CV)",
      ranking_fav: "お気に入り TOP 5", ranking_restock: "再入荷通知 TOP 5",
      col_img: "画像", col_prod: "商品", col_count: "登録数", col_req: "リクエスト (うち購入)", unit_buy: "件 購入", unit_count: "件", unit_user: "人",
      empty_data: "この期間のデータはありません",
      csv_title: "CSVエクスポート設定", csv_desc: "出力したい項目にチェックを入れてください。設定はブラウザに保存されます。",
      btn_dl: "CSVをダウンロード", btn_cancel: "キャンセル", btn_all: "全選択", btn_clear: "全解除",
      grp_basic: "基本情報", grp_cust: "顧客情報", grp_prod: "商品情報", grp_cv: "分析・コンバージョン",
      col_date: "日時", col_type: "アクションタイプ", col_id: "ID",
      col_uid: "顧客ID", col_uname: "顧客名", col_uemail: "メールアドレス",
      col_pname: "商品名", col_handle: "ハンドル", col_var: "バリエーションID", col_sku: "SKU",
      col_cat: "流入カテゴリー", col_ref: "URL", col_notified: "通知ステータス",
      col_is_cv: "購入ステータス", col_cv_at: "購入日時", col_price: "購入金額",
      adv_title: "分析のヒント：データを活用して売上を伸ばしましょう！",
      adv_1: "お気に入り数が多い商品は、潜在的な需要が高い商品です。在庫を多めに確保したり、セールやメルマガでプッシュしてみましょう。",
      adv_2: "再入荷通知リクエストが多い商品は、確実な購入見込み客が待っています。優先的に再入荷手配を行い、機会損失を防ぎましょう。",
      adv_3: "流入元（リファラー）を確認し、効果の高い集客チャネル（Instagram、検索エンジンなど）にマーケティング活動を集中させると効率的です。",
      pii_warning: "顧客データ（名前・メール）の表示権限がありません。アプリ管理画面でデータアクセス権限を申請してください。",
      csv_summary: "【流入元サマリー】", csv_period: "集計期間:",
      csv_source: "流入元", csv_total: "総件数", csv_unique: "ユニーク人数", csv_fav: "お気に入り", csv_restock: "入荷通知", csv_cv: "購入数(CV)",
      csv_detail: "【詳細トラッキングデータ】"
    },
    en: {
      title: "Integrated Analytics Dashboard",
      period_label: "Period", p_7: "Last 7 Days", p_30: "Last 30 Days", p_all: "All Time", p_custom: "Custom Range...",
      btn_date: "Select Dates", btn_apply: "Apply", btn_export: "Export CSV", display: "Displaying",
      kpi_fav: "Favorites", kpi_restock: "Restock Requests", kpi_cv_count: "Recovered Orders (CV)", kpi_cv_rate: "Conversion Rate",
      kpi_users: "Active Users", kpi_potential_rev: "Potential Revenue", kpi_aov: "Average Order Value", kpi_revenue: "Total Revenue",
      tab_source: "Traffic Source Analysis", tab_trend: "Demand & Performance Trend",
      source_name: "Source", source_total: "Total", source_fav: "Favs", source_restock: "Restocks", source_cv: "Purchased",
      ranking_fav: "Top 5 Favorites", ranking_restock: "Top 5 Restock Requests",
      col_img: "Image", col_prod: "Product", col_count: "Count", col_req: "Requests (Purchased)", unit_buy: " bought", unit_count: "", unit_user: "",
      empty_data: "No data available for this period.",
      csv_title: "CSV Export Settings", csv_desc: "Select columns to export. Settings are saved in your browser.",
      btn_dl: "Download CSV", btn_cancel: "Cancel", btn_all: "Select All", btn_clear: "Clear All",
      grp_basic: "Basic Info", grp_cust: "Customer Info", grp_prod: "Product Info", grp_cv: "Analytics & CV",
      col_date: "Date", col_type: "Action Type", col_id: "ID",
      col_uid: "User ID", col_uname: "User Name", col_uemail: "Email",
      col_pname: "Product Name", col_handle: "Handle", col_var: "Variant ID", col_sku: "SKU",
      col_cat: "Source Category", col_ref: "URL", col_notified: "Notification Status",
      col_is_cv: "Purchase Status", col_cv_at: "Purchase Date", col_price: "Purchase Amount",
      adv_title: "Analysis Tips: Leverage Data to Boost Sales!",
      adv_1: "Products with many favorites have high potential demand. Secure stock and promote them via sales or newsletters.",
      adv_2: "Products with many restock requests have waiting customers. Restock them prioritizing to prevent lost sales.",
      adv_3: "Check traffic sources to focus your marketing efforts on effective channels like Instagram or Search Engines.",
      pii_warning: "Customer data access is restricted. Please check 'Protected Customer Data' access in your Shopify Partner Dashboard.",
      csv_summary: "[Traffic Source Summary]", csv_period: "Period:",
      csv_source: "Source", csv_total: "Total", csv_unique: "Unique Users", csv_fav: "Favorites", csv_restock: "Restock Requests", csv_cv: "Purchases (CV)",
      csv_detail: "[Detailed Tracking Data]"
    },
    zh: {
      title: "綜合分析儀表板",
      period_label: "統計期間", p_7: "過去7天", p_30: "過去30天", p_all: "全部期間", p_custom: "自定義期間...",
      btn_date: "選擇日期", btn_apply: "應用", btn_export: "導出CSV", display: "顯示中",
      kpi_fav: "收藏數", kpi_restock: "補貨通知數", kpi_cv_count: "恢復訂單 (CV)", kpi_cv_rate: "轉化率",
      kpi_users: "活躍用戶數", kpi_potential_rev: "潛在營收", kpi_aov: "平均客單價", kpi_revenue: "總營收",
      tab_source: "流量來源分析", tab_trend: "需求與績效趨勢",
      source_name: "來源", source_total: "總數", source_fav: "收藏", source_restock: "通知", source_cv: "購買",
      ranking_fav: "熱門收藏 TOP 5", ranking_restock: "熱門補貨通知 TOP 5",
      col_img: "圖片", col_prod: "商品", col_count: "數量", col_req: "請求 (其中購買)", unit_buy: "件 購買", unit_count: "", unit_user: "",
      empty_data: "此期間無數據",
      csv_title: "CSV導出設置", csv_desc: "請選擇要導出的項目。設置將保存在瀏覽器中。",
      btn_dl: "下載CSV", btn_cancel: "取消", btn_all: "全選", btn_clear: "清空",
      grp_basic: "基本信息", grp_cust: "客戶信息", grp_prod: "商品信息", grp_cv: "分析與轉化",
      col_date: "日期", col_type: "類型", col_id: "ID",
      col_uid: "客戶ID", col_uname: "客戶名稱", col_uemail: "電子郵件",
      col_pname: "商品名稱", col_handle: "Handle", col_var: "變體ID", col_sku: "SKU",
      col_cat: "來源類別", col_ref: "URL", col_notified: "通知狀態",
      col_is_cv: "購買狀態", col_cv_at: "購買日期", col_price: "購買金額",
      adv_title: "分析技巧：利用數據提升銷量！",
      adv_1: "收藏數多的商品具有很高的潛在需求。請確保庫存，並通過促銷或電子郵件進行推廣。",
      adv_2: "補貨請求多的商品有確定的購買意向。優先補貨以防止銷售流失。",
      adv_3: "檢查流量來源，將營銷活動集中在高效渠道（如Instagram、搜索引擎）上。",
      pii_warning: "無法訪問客戶數據。請在Shopify合作夥伴儀表板中檢查“受保護的客戶數據”訪問權限。",
      csv_summary: "【流量來源摘要】", csv_period: "統計期間:",
      csv_source: "來源", csv_total: "總數", csv_unique: "唯一用戶", csv_fav: "收藏", csv_restock: "補貨通知", csv_cv: "購買數(CV)",
      csv_detail: "【詳細追踪數據】"
    },
    fr: {
      title: "Tableau de bord analytique",
      period_label: "Période", p_7: "7 derniers jours", p_30: "30 derniers jours", p_all: "Tout le temps", p_custom: "Personnalisé...",
      btn_date: "Choisir dates", btn_apply: "Appliquer", btn_export: "Exporter CSV", display: "Affichage",
      kpi_fav: "Favoris", kpi_restock: "Demandes stock", kpi_cv_count: "Commandes récupérées", kpi_cv_rate: "Taux de conversion",
      kpi_users: "Utilisateurs actifs", kpi_potential_rev: "Revenu Potentiel", kpi_aov: "Panier moyen", kpi_revenue: "Revenu total",
      tab_source: "Analyse des sources", tab_trend: "Tendance demande & perf.",
      source_name: "Source", source_total: "Total", source_fav: "Fav", source_restock: "Stock", source_cv: "Achat",
      ranking_fav: "Top 5 Favoris", ranking_restock: "Top 5 Demandes stock",
      col_img: "Image", col_prod: "Produit", col_count: "Qté", col_req: "Demandes (Acheté)", unit_buy: " achetés", unit_count: "", unit_user: "",
      empty_data: "Aucune donnée pour cette période.",
      csv_title: "Paramètres d'export CSV", csv_desc: "Sélectionnez les colonnes. Paramètres enregistrés.",
      btn_dl: "Télécharger CSV", btn_cancel: "Annuler", btn_all: "Tout", btn_clear: "Vider",
      grp_basic: "Infos de base", grp_cust: "Infos client", grp_prod: "Infos produit", grp_cv: "Analyse & CV",
      col_date: "Date", col_type: "Type", col_id: "ID",
      col_uid: "ID Client", col_uname: "Nom", col_uemail: "Email",
      col_pname: "Nom du produit", col_handle: "Handle", col_var: "ID Variante", col_sku: "SKU",
      col_cat: "Source", col_ref: "URL", col_notified: "Statut notif.",
      col_is_cv: "Statut achat", col_cv_at: "Date achat", col_price: "Montant",
      adv_title: "Conseils d'analyse : Boostez vos ventes !",
      adv_1: "Les produits très favoris ont une forte demande. Sécurisez le stock et faites de la promotion.",
      adv_2: "Les demandes de stock indiquent des clients en attente. Réapprovisionnez en priorité.",
      adv_3: "Vérifiez les sources de trafic et concentrez le marketing sur les canaux efficaces.",
      pii_warning: "Accès aux données client restreint. Vérifiez les autorisations dans le tableau de bord partenaire Shopify.",
      csv_summary: "[Résumé des sources]", csv_period: "Période:",
      csv_source: "Source", csv_total: "Total", csv_unique: "Visiteurs uniques", csv_fav: "Favoris", csv_restock: "Demandes stock", csv_cv: "Achats (CV)",
      csv_detail: "[Données de suivi détaillées]"
    },
    de: {
      title: "Analyse-Dashboard",
      period_label: "Zeitraum", p_7: "Letzte 7 Tage", p_30: "Letzte 30 Tage", p_all: "Gesamt", p_custom: "Benutzerdefiniert...",
      btn_date: "Datum wählen", btn_apply: "Anwenden", btn_export: "CSV Export", display: "Anzeige",
      kpi_fav: "Favoriten", kpi_restock: "Benachrichtigungen", kpi_cv_count: "Bestellungen (CV)", kpi_cv_rate: "Konversionsrate",
      kpi_users: "Aktive Nutzer", kpi_potential_rev: "Potenzieller Umsatz", kpi_aov: "Ø Bestellwert", kpi_revenue: "Gesamtumsatz",
      tab_source: "Traffic-Quellen", tab_trend: "Nachfrage & Leistung",
      source_name: "Quelle", source_total: "Gesamt", source_fav: "Fav", source_restock: "Stock", source_cv: "Kauf",
      ranking_fav: "Top 5 Favoriten", ranking_restock: "Top 5 Anfragen",
      col_img: "Bild", col_prod: "Produkt", col_count: "Anz.", col_req: "Anfragen (Gekauft)", unit_buy: " gekauft", unit_count: "", unit_user: "",
      empty_data: "Keine Daten verfügbar.",
      csv_title: "CSV Export Einstellungen", csv_desc: "Spalten auswählen. Einstellungen werden gespeichert.",
      btn_dl: "CSV Herunterladen", btn_cancel: "Abbrechen", btn_all: "Alle", btn_clear: "Leeren",
      grp_basic: "Basisinfo", grp_cust: "Kundeninfo", grp_prod: "Produktinfo", grp_cv: "Analyse & CV",
      col_date: "Datum", col_type: "Typ", col_id: "ID",
      col_uid: "Kunden-ID", col_uname: "Name", col_uemail: "E-Mail",
      col_pname: "Produktname", col_handle: "Handle", col_var: "Varianten-ID", col_sku: "SKU",
      col_cat: "Quelle", col_ref: "URL", col_notified: "Status",
      col_is_cv: "Kaufstatus", col_cv_at: "Kaufdatum", col_price: "Betrag",
      adv_title: "Analyse-Tipps: Umsatz steigern!",
      adv_1: "Produkte mit vielen Favoriten haben hohe Nachfrage. Sichern Sie den Bestand und bewerben Sie sie.",
      adv_2: "Viele Nachschub-Anfragen bedeuten wartende Kunden. Priorisieren Sie die Wiederbeschaffung.",
      adv_3: "Prüfen Sie Traffic-Quellen und fokussieren Sie Marketing auf effektive Kanäle.",
      pii_warning: "Kundendatenzugriff eingeschränkt. Bitte prüfen Sie die Berechtigungen im Shopify Partner Dashboard.",
      csv_summary: "[Quellenzusammenfassung]", csv_period: "Zeitraum:",
      csv_source: "Quelle", csv_total: "Gesamt", csv_unique: "Einzigartige Nutzer", csv_fav: "Favoriten", csv_restock: "Benachrichtigungen", csv_cv: "Käufe (CV)",
      csv_detail: "[Detaillierte Tracking-Daten]"
    },
    es: {
      title: "Panel de Análisis",
      period_label: "Período", p_7: "Últimos 7 días", p_30: "Últimos 30 días", p_all: "Todo", p_custom: "Personalizado...",
      btn_date: "Elegir fechas", btn_apply: "Aplicar", btn_export: "Exportar CSV", display: "Mostrando",
      kpi_fav: "Favoritos", kpi_restock: "Solicitudes stock", kpi_cv_count: "Pedidos recup. (CV)", kpi_cv_rate: "Tasa conversión",
      kpi_users: "Usuarios activos", kpi_potential_rev: "Ingresos Potenciales", kpi_aov: "Valor medio pedido", kpi_revenue: "Ingresos totales",
      tab_source: "Análisis de fuentes", tab_trend: "Tendencia demanda y rend.",
      source_name: "Fuente", source_total: "Total", source_fav: "Fav", source_restock: "Stock", source_cv: "Compra",
      ranking_fav: "Top 5 Favoritos", ranking_restock: "Top 5 Solicitudes",
      col_img: "Imagen", col_prod: "Producto", col_count: "Cant.", col_req: "Solicitudes (Comprado)", unit_buy: " comprados", unit_count: "", unit_user: "",
      empty_data: "No hay datos para este período.",
      csv_title: "Configuración CSV", csv_desc: "Seleccione columnas. Se guardará en el navegador.",
      btn_dl: "Descargar CSV", btn_cancel: "Cancelar", btn_all: "Todos", btn_clear: "Limpiar",
      grp_basic: "Info básica", grp_cust: "Info cliente", grp_prod: "Info producto", grp_cv: "Análisis & CV",
      col_date: "Fecha", col_type: "Tipo", col_id: "ID",
      col_uid: "ID Cliente", col_uname: "Nombre", col_uemail: "Email",
      col_pname: "Nombre Producto", col_handle: "Handle", col_var: "ID Variante", col_sku: "SKU",
      col_cat: "Fuente", col_ref: "URL", col_notified: "Notificación",
      col_is_cv: "Estado Compra", col_cv_at: "Fecha Compra", col_price: "Monto",
      adv_title: "Consejos de análisis: ¡Aumente sus ventas!",
      adv_1: "Los productos muy favoritos tienen alta demanda. Asegure stock y promuévalos.",
      adv_2: "Las solicitudes de stock indican clientes en espera. Reponga con prioridad.",
      adv_3: "Verifique fuentes de tráfico y enfoque el marketing en canales efectivos.",
      pii_warning: "Acceso restringido a datos de clientes. Verifique los permisos en el panel de socios de Shopify.",
      csv_summary: "[Resumen de fuentes]", csv_period: "Período:",
      csv_source: "Fuente", csv_total: "Total", csv_unique: "Usuarios únicos", csv_fav: "Favoritos", csv_restock: "Solicitudes", csv_cv: "Compras (CV)",
      csv_detail: "[Datos de seguimiento detallados]"
    }
  };

  const text = t[lang] || t.en;

  const getDateRangeLabel = () => {
    if (currentPeriod === '7') return text.p_7;
    if (currentPeriod === '30') return text.p_30;
    if (currentPeriod === 'all') return text.p_all;
    if (currentPeriod === 'custom' && startParam && endParam) return `${startParam} 〜 ${endParam}`;
    return text.p_7;
  };

  const [popoverActive, setPopoverActive] = useState(false);
  const [{ month, year }, setDate] = useState({ month: new Date().getMonth(), year: new Date().getFullYear() });
  const [selectedDates, setSelectedDates] = useState({
    start: startParam ? new Date(startParam) : new Date(),
    end: endParam ? new Date(endParam) : new Date(),
  });

  const togglePopover = useCallback(() => setPopoverActive((popoverActive) => !popoverActive), []);
  const handleMonthChange = useCallback((month, year) => setDate({ month, year }), []);
  const handleDateSelection = useCallback(({ end: newEnd, start: newStart }) => setSelectedDates({ start: newStart, end: newEnd }), []);

  const toLocaleDateString = (date) => {
    if (!date) return "";
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const applyCustomDate = () => {
    const startStr = toLocaleDateString(selectedDates.start);
    const endStr = toLocaleDateString(selectedDates.end);
    submit({ period: "custom", start: startStr, end: endStr }, { method: "get", replace: true });
    setPopoverActive(false);
  };

  const handlePeriodChange = (value) => {
    setCurrentPeriod(value); 
    if (value === "custom") {
      setPopoverActive(true); 
    } else {
      setPopoverActive(false);
      submit({ period: value }, { method: "get", replace: true });
    }
  };

  const COLUMN_GROUPS = [
    { title: text.grp_basic, options: [{ label: 'ID', value: 'id' }, { label: text.col_date, value: 'date' }, { label: text.col_type, value: 'type' }] },
    { title: text.grp_cust, options: [{ label: text.col_uid, value: 'userId' }, { label: text.col_uname, value: 'userName' }, { label: text.col_uemail, value: 'userEmail' }] },
    { title: text.grp_prod, options: [{ label: text.col_pname, value: 'name' }, { label: text.col_handle, value: 'handle' }, { label: text.col_var, value: 'variantId' }, { label: text.col_sku, value: 'sku' }] },
    { title: text.grp_cv, options: [{ label: text.col_cat, value: 'category' }, { label: text.col_ref, value: 'referrer' }, { label: text.col_notified, value: 'isNotified' }, { label: text.col_is_cv, value: 'isConverted' }, { label: text.col_cv_at, value: 'convertedAt' }, { label: text.col_price, value: 'convertedPrice' }] }
  ];
  const ALL_COLUMN_VALUES = COLUMN_GROUPS.flatMap(g => g.options.map(o => o.value));

  const [activeModal, setActiveModal] = useState(false);
  const toggleModal = useCallback(() => setActiveModal((active) => !active), []);
  const [selectedColumns, setSelectedColumns] = useState(ALL_COLUMN_VALUES);

  useEffect(() => {
    const saved = localStorage.getItem('wishflow_csv_columns');
    if (saved) { try { const parsed = JSON.parse(saved); if (Array.isArray(parsed) && parsed.length > 0) setSelectedColumns(parsed); } catch (e) { } }
  }, []);

  const handleCheckboxChange = (newChecked, value) => {
    if (newChecked) setSelectedColumns((prev) => [...prev, value]);
    else setSelectedColumns((prev) => prev.filter((c) => c !== value));
  };

  const handleSelectAll = () => {
    if (selectedColumns.length === ALL_COLUMN_VALUES.length) setSelectedColumns([]);
    else setSelectedColumns(ALL_COLUMN_VALUES);
  };

  const handleDownloadCSV = () => {
    const flatOptions = COLUMN_GROUPS.flatMap(g => g.options);
    const headers = flatOptions.filter(o => selectedColumns.includes(o.value)).map(o => o.label);
    const keys = flatOptions.filter(o => selectedColumns.includes(o.value)).map(o => o.value);
    
    const csvRows = [
      [text.csv_summary, `${text.csv_period} ${getDateRangeLabel()}`],
      [text.csv_source, text.csv_total, text.csv_unique, text.csv_fav, text.csv_restock, text.csv_cv],
      ...sourceData.map(s => [s.name, s.total, s.unique, s.favs, s.restocks, s.conversions]),
      [],
      [text.csv_detail],
      headers
    ];
    
    rawDetailedData.forEach(d => {
      const row = keys.map(key => {
        let val = d[key];

        // ▼▼ ここでブラウザ（各国のPC）の現地時間に自動変換！ ▼▼
        if ((key === 'date' || key === 'convertedAt') && val && val !== "-") {
          const bTime = new Date(val); // ブラウザが現地時間を自動で計算
          val = `${bTime.getFullYear()}/${String(bTime.getMonth() + 1).padStart(2, '0')}/${String(bTime.getDate()).padStart(2, '0')} ${String(bTime.getHours()).padStart(2, '0')}:${String(bTime.getMinutes()).padStart(2, '0')}`;
        }
        // ▲▲ ここまで ▲▲

        if (key === 'variantId' || key === 'userId') val = `'${val}`;
        return val || "";
      });
      csvRows.push(row);
    });
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvRows.map(e => e.join(",")).join("\n")], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `analysis_${period === 'custom' ? 'custom' : period + 'days'}.csv`; link.click();
    localStorage.setItem('wishflow_csv_columns', JSON.stringify(selectedColumns));
    toggleModal();
  };

  return (
    <Page title={text.title} backAction={{ content: 'Home', onAction: () => window.history.back() }}>
      <BlockStack gap="600">
        
        <Banner tone="success" title={text.adv_title}>
          <BlockStack gap="200">
            <Text as="p">📈 {text.adv_1}</Text>
            <Text as="p">🔔 {text.adv_2}</Text>
            <Text as="p">📣 {text.adv_3}</Text>
          </BlockStack>
        </Banner>

        <div style={{ opacity: isLoading ? 0.5 : 1, transition: "opacity 0.2s" }}>
          <Layout>
            {/* 1. 期間選択 ＆ CSVエクスポート */}
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="400" blockAlign="center">
                      <Select 
                        label={text.period_label} 
                        labelHidden
                        options={[{label: text.p_7, value: '7'}, {label: text.p_30, value: '30'}, {label: text.p_all, value: 'all'}, {label: text.p_custom, value: 'custom'}]} 
                        onChange={handlePeriodChange} 
                        value={currentPeriod} 
                        disabled={isLoading} 
                      />
                      {currentPeriod === 'custom' && (
                        <Popover
                          active={popoverActive}
                          activator={
                            <Button onClick={togglePopover} icon={CalendarIcon} disabled={isLoading}>
                              {startParam ? `${startParam} 〜 ${endParam}` : text.btn_date}
                            </Button>
                          }
                          onClose={togglePopover}
                        >
                          <Box padding="400">
                            <BlockStack gap="400">
                              <DatePicker month={month} year={year} onChange={handleDateSelection} onMonthChange={handleMonthChange} selected={selectedDates} allowRange />
                              <InlineStack align="end"><Button variant="primary" onClick={applyCustomDate}>{text.btn_apply}</Button></InlineStack>
                            </BlockStack>
                          </Box>
                        </Popover>
                      )}
                      <InlineStack gap="200" blockAlign="center">
                        <Text tone="subdued" variant="bodySm">{text.display}: {getDateRangeLabel()}</Text>
                        {isLoading && <Spinner size="small" />}
                      </InlineStack>
                    </InlineStack>
                    <Button icon={ExportIcon} onClick={toggleModal} disabled={isLoading}>{text.btn_export}</Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* 2. KPIカード（8枚） */}
            <Layout.Section>
               <InlineGrid columns={{xs: 1, sm: 2, md: 4}} gap="400">
                 
                 <Card>
                   <BlockStack gap="200">
                     <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}>
                       <div style={{ width: '20px', display: 'flex' }}><Icon source={HeartIcon} tone="subdued" /></div>
                       <Text variant="headingSm" tone="subdued">{text.kpi_fav}</Text>
                     </div>
                     <Text variant="heading2xl" tone="success" alignment="end">{summary.totalFavs}<span style={{ fontSize: '14px', fontWeight: 'normal' }}>{text.unit_count}</span></Text>
                   </BlockStack>
                 </Card>
                 <Card>
                   <BlockStack gap="200">
                     <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}>
                       <div style={{ width: '20px', display: 'flex' }}><Icon source={EmailIcon} tone="subdued" /></div>
                       <Text variant="headingSm" tone="subdued">{text.kpi_restock}</Text>
                     </div>
                     <Text variant="heading2xl" tone="critical" alignment="end">{summary.totalRestocks}<span style={{ fontSize: '14px', fontWeight: 'normal' }}>{text.unit_count}</span></Text>
                   </BlockStack>
                 </Card>
                 <Card>
                   <BlockStack gap="200">
                     <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}>
                       <div style={{ width: '20px', display: 'flex' }}><Icon source={OrderIcon} tone="subdued" /></div>
                       <Text variant="headingSm" tone="subdued">{text.kpi_cv_count}</Text>
                     </div>
                     <Text variant="heading2xl" tone="info" alignment="end">{summary.totalConversions}<span style={{ fontSize: '14px', fontWeight: 'normal' }}>{text.unit_count}</span></Text>
                   </BlockStack>
                 </Card>
                 <Card>
                   <BlockStack gap="200">
                     <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}>
                       <div style={{ width: '20px', display: 'flex' }}><Icon source={MoneyIcon} tone="subdued" /></div>
                       <Text variant="headingSm" tone="subdued">{text.kpi_cv_rate}</Text>
                     </div>
                     <Text variant="heading2xl" alignment="end">{summary.conversionRate}%</Text>
                   </BlockStack>
                 </Card>

                 <Card>
                   <BlockStack gap="200">
                     <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}>
                       <div style={{ width: '20px', display: 'flex' }}><Icon source={PersonIcon} tone="subdued" /></div>
                       <Text variant="headingSm" tone="subdued">{text.kpi_users}</Text>
                     </div>
                     <Text variant="heading2xl" tone="base" alignment="end">{summary.totalUniqueUsers}<span style={{ fontSize: '14px', fontWeight: 'normal' }}>{text.unit_user}</span></Text>
                   </BlockStack>
                 </Card>
                 <Card>
                   <BlockStack gap="200">
                     <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}>
                       <div style={{ width: '20px', display: 'flex' }}><Icon source={MoneyIcon} tone="subdued" /></div>
                       <Text variant="headingSm" tone="subdued">{text.kpi_potential_rev}</Text>
                     </div>
                     <Text variant="heading2xl" tone="base" alignment="end">{summary.potentialRevenue.toLocaleString()}</Text>
                   </BlockStack>
                 </Card>
                 <Card>
                   <BlockStack gap="200">
                     <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}>
                       <div style={{ width: '20px', display: 'flex' }}><Icon source={MoneyIcon} tone="subdued" /></div>
                       <Text variant="headingSm" tone="subdued">{text.kpi_aov}</Text>
                     </div>
                     <Text variant="heading2xl" tone="base" alignment="end">{summary.aov.toLocaleString()}</Text>
                   </BlockStack>
                 </Card>
                 <Card>
                   <BlockStack gap="200">
                     <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}>
                       <div style={{ width: '20px', display: 'flex' }}><Icon source={MoneyIcon} tone="subdued" /></div>
                       <Text variant="headingSm" tone="subdued">{text.kpi_revenue}</Text>
                     </div>
                     <Text variant="heading2xl" tone="base" alignment="end">{summary.totalRevenue.toLocaleString()}</Text>
                   </BlockStack>
                 </Card>

               </InlineGrid>
            </Layout.Section>

            {/* CSV Modal */}
            <Modal
              open={activeModal}
              onClose={toggleModal}
              title={text.csv_title}
              primaryAction={{ content: text.btn_dl, onAction: handleDownloadCSV }}
              secondaryActions={[{ content: text.btn_cancel, onAction: toggleModal }, { content: selectedColumns.length === ALL_COLUMN_VALUES.length ? text.btn_clear : text.btn_all, onAction: handleSelectAll }]}
            >
              <Modal.Section>
                <BlockStack gap="500">
                  <Text as="p" tone="subdued">{text.csv_desc}</Text>
                  {COLUMN_GROUPS.map((group, groupIndex) => (
                    <Box key={groupIndex} paddingBlockEnd="200">
                      <BlockStack gap="300">
                        <Text variant="headingSm" as="h3">{group.title}</Text>
                        <InlineGrid columns={{xs: 1, sm: 2}} gap="300">
                          {group.options.map((opt) => (
                            <Checkbox key={opt.value} label={opt.label} checked={selectedColumns.includes(opt.value)} onChange={(newChecked) => handleCheckboxChange(newChecked, opt.value)} />
                          ))}
                        </InlineGrid>
                      </BlockStack>
                      {groupIndex < COLUMN_GROUPS.length - 1 && <Box paddingBlockStart="300"><Divider /></Box>}
                    </Box>
                  ))}
                </BlockStack>
              </Modal.Section>
            </Modal>

            {/* 3. 流入元（リファラー）分析：スクロール＆Top5仕様 */}
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" align="start" blockAlign="center" wrap={false}>
                    <div style={{ width: 20, height: 20 }}><Icon source={LinkIcon} tone="base" /></div>
                    <Text variant="headingMd" as="h2">{text.tab_source}</Text>
                  </InlineStack>
                  <Divider />
                  
                  <InlineGrid columns={{xs: 1, md: 2}} gap="600" alignItems="start"> 
                    <Box>
                      {sourceData.length > 0 ? (
                        (() => {
                          const MAX_SLICES = 5;
                          let pieData = sourceData;
                          if (sourceData.length > MAX_SLICES) {
                            const top = sourceData.slice(0, MAX_SLICES);
                            const restTotal = sourceData.slice(MAX_SLICES).reduce((sum, item) => sum + item.total, 0);
                            pieData = [...top, { name: 'その他 (少数流入)', total: restTotal }];
                          }
                          return (
                            <ResponsiveContainer width="100%" height={280}>
                              <PieChart margin={{ top: 30, right: 20, bottom: 10, left: 20 }}>
  <Pie data={pieData} dataKey="total" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                                  {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={SOURCE_COLORS[entry.name] || '#B9B9B9'} />)}
                                </Pie>
                                <Tooltip />
                                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '15px' }} />
                              </PieChart>
                            </ResponsiveContainer>
                          );
                        })()
                      ) : <Box padding="500"><Text tone="subdued" alignment="center">{text.empty_data}</Text></Box>}
                    </Box>
                    <Box>
                      <div style={{ maxHeight: '280px', overflowY: 'auto', border: '1px solid #ebebeb', borderRadius: '8px' }}>
                        <DataTable
                          columnContentTypes={['text', 'numeric', 'numeric', 'numeric', 'numeric']}
                          headings={[text.source_name, text.source_total, text.source_fav, text.source_restock, text.source_cv]}
                          rows={sourceData.map(s => [<Badge tone="info">{s.name}</Badge>, <Text fontWeight="bold">{s.total}</Text>, s.favs, s.restocks, <Text tone="success" fontWeight="bold">{s.conversions}</Text>])}
                        />
                      </div>
                    </Box>
                  </InlineGrid>
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* 4. 需要と成果のトレンド */}
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">{text.tab_trend}</Text>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis /><Tooltip /><Legend />
                      <Line type="monotone" dataKey="val1" name={text.kpi_fav} stroke="#008060" strokeWidth={3} />
                      <Line type="monotone" dataKey="val2" name={text.kpi_restock} stroke="#FF4D4D" strokeWidth={3} />
                      <Line type="monotone" dataKey="val3" name={text.source_cv} stroke="#2C6ECB" strokeWidth={3} activeDot={{ r: 8 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* 5. お気に入り TOP 5 */}
            <Layout.Section variant="oneHalf">
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2" tone="success">{text.ranking_fav}</Text>
                  <BlockStack gap="0">
                    <Box paddingBlockEnd="200">
                      <InlineGrid columns="1fr auto" gap="400">
                        <Text tone="subdued" variant="bodySm">{text.col_prod}</Text>
                        <Text tone="subdued" alignment="end" variant="bodySm">{text.col_count}</Text>
                      </InlineGrid>
                    </Box>
                    <Divider />
                    {favData.map((item, i) => (
                      <div key={i}>
                        <Box paddingBlockStart="300" paddingBlockEnd="300">
                          <InlineGrid columns="40px 1fr auto" gap="400" alignItems="center">
                            <Thumbnail source={item.image || ImageIcon} size="small" alt="" />
                            <div style={{ minWidth: 0, overflow: 'hidden' }}>
                              <Text truncate as="span" fontWeight="bold">{item.name}</Text>
                            </div>
                            <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <Text as="span">{item.count}</Text>
                            </div>
                          </InlineGrid>
                        </Box>
                        {i !== favData.length - 1 && <Divider />} 
                      </div>
                    ))}
                    {favData.length === 0 && <Box padding="400"><Text tone="subdued" alignment="center">{text.empty_data}</Text></Box>}
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* 6. 再入荷通知 TOP 5 */}
            <Layout.Section variant="oneHalf">
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2" tone="critical">{text.ranking_restock}</Text>
                  <BlockStack gap="0">
                    <Box paddingBlockEnd="200">
                      <InlineGrid columns="1fr auto" gap="400">
                        <Text tone="subdued" variant="bodySm">{text.col_prod}</Text>
                        <Text tone="subdued" alignment="end" variant="bodySm">{text.col_req}</Text>
                      </InlineGrid>
                    </Box>
                    <Divider />
                    {restockData.map((item, i) => (
                      <div key={i}>
                        <Box paddingBlockStart="300" paddingBlockEnd="300">
                          <InlineGrid columns="40px 1fr auto" gap="400" alignItems="center">
                            <Thumbnail source={item.image || ImageIcon} size="small" alt="" />
                            <div style={{ minWidth: 0, overflow: 'hidden' }}>
                              <Text truncate as="span" fontWeight="bold">{item.name}</Text>
                            </div>
                            <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <BlockStack align="end">
                                <Text as="span">{item.count}</Text>
                                {item.converted > 0 && <Text tone="success" variant="bodySm">({item.converted}{text.unit_buy})</Text>}
                              </BlockStack>
                            </div>
                          </InlineGrid>
                        </Box>
                        {i !== restockData.length - 1 && <Divider />}
                      </div>
                    ))}
                    {restockData.length === 0 && <Box padding="400"><Text tone="subdued" alignment="center">{text.empty_data}</Text></Box>}
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        </div>
        <Box paddingBlockEnd="1000" />
      </BlockStack>
    </Page>
  );
}