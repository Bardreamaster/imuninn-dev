import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";

import { MuninnCore, type StatusEvent } from "../../modules/muninn-core/src";
import { Button, Row } from "./components";
import { t } from "./i18n";
import { useTheme } from "./theme";

/** Bottom sheet opened from the header's connection pill: the connected PCs. */
export function RemoteSheet({ status, visible, onClose }: { status: StatusEvent | null; visible: boolean; onClose: () => void }) {
  const { C, S } = useTheme();
  const { height } = useWindowDimensions();
  const clients = status?.clients ?? [];
  return (
    <Modal visible={visible} transparent animationType="slide" supportedOrientations={["portrait", "landscape"]} onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.scrim }} onPress={onClose}
          accessibilityRole="button" accessibilityLabel={t("close")} />
        <View style={{ backgroundColor: C.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: height * 0.7,
          paddingHorizontal: 16, paddingTop: 8, paddingBottom: 34, gap: 12 }}>
          <View style={{ alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: C.border }} />
          <View style={S.cardHead}>
            <Text style={S.cardTitle}>{t("remote.title")}{clients.length ? ` · ${clients.length}` : ""}</Text>
            <Button small title={t("close")} kind="ghost" onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={{ gap: 10 }}>
            {clients.length === 0 ? (
              <View style={{ gap: 4 }}>
                <Text style={S.key}>{t("remote.none")}</Text>
                <Text style={S.muted}>{status && (status.addresses ?? []).length === 0 ? t("net.none.hint") : t("waiting.pc")}</Text>
              </View>
            ) : clients.map((c) => (
              <View key={c.id} style={{ backgroundColor: C.cardAlt, borderRadius: 10, padding: 12, gap: 4 }}>
                <View style={S.row}>
                  <Text style={[S.streamTitle, { flexShrink: 1 }]} numberOfLines={1}>{c.name}</Text>
                  {c.writer ? <Text style={S.badge}>{t("remote.writer")}</Text> : null}
                </View>
                <Row k={t("address")} v={c.host} selectable />
                <Row k={t("remote.streams")} v={c.subscribed.join(", ") || t("not.subscribed")} />
                <Row k={t("remote.drops")} v={`${c.udpDropped} / ${c.tcpDropped}`} color={c.udpDropped || c.tcpDropped ? C.warnText : undefined} />
              </View>
            ))}
            {status?.writer ? (
              <Button title={t("take.over")} kind="ghost" onPress={() => MuninnCore.takeOver()} />
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
