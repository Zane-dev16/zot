// Run list + composer: ports ios/ContentView.swift:38-66 (List, "New run"
// section, Refresh/Unpair toolbar) and :96-125 (load/send). The stream
// (src/api/stream.ts) folds run.state events into the list; polling is the
// fallback while the socket is not live.

import React from "react";
import {
	Button,
	FlatList,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";

import type { AgentRun } from "../api/client.ts";
import type { StreamStatus } from "../api/stream.ts";

export type RunsScreenProps = {
	runs: AgentRun[];
	error: string;
	status: StreamStatus;
	title: string;
	prompt: string;
	busy: boolean;
	onChangeTitle(title: string): void;
	onChangePrompt(prompt: string): void;
	onSend(): void;
	onRefresh(): void;
	onUnpair(): void;
};

export function statusLabel(status: StreamStatus): string {
	if (status === "live") return "live";
	if (status === "auth") return "auth failed";
	if (status === "reconnecting") return "reconnecting";
	if (status === "connecting") return "connecting";
	return "idle";
}

export function RunsScreen(props: RunsScreenProps): React.ReactElement {
	const composer = (
		<View style={styles.composer}>
			<Text style={styles.section}>New run</Text>
			<TextInput
				testID="composer-title"
				style={styles.input}
				value={props.title}
				onChangeText={props.onChangeTitle}
				placeholder="Title (optional)"
				autoCorrect={false}
			/>
			<TextInput
				testID="composer-prompt"
				style={styles.input}
				value={props.prompt}
				onChangeText={props.onChangePrompt}
				placeholder="Prompt"
				multiline
			/>
			<View style={styles.actions}>
				<Button
					testID="composer-send"
					title="Send"
					onPress={props.onSend}
					disabled={props.busy}
				/>
			</View>
			{props.error !== "" ? (
				<Text testID="runs-error" style={styles.error}>
					{props.error}
				</Text>
			) : null}
		</View>
	);

	return (
		<View style={styles.container}>
			<View style={styles.toolbar}>
				<Text style={styles.title}>Zot</Text>
				<View style={styles.toolbarRight}>
					<Text testID="runs-status" style={styles.status}>
						{statusLabel(props.status)}
					</Text>
					<Button
						testID="runs-refresh"
						title="Refresh"
						onPress={props.onRefresh}
					/>
					<Button testID="runs-unpair" title="Unpair" onPress={props.onUnpair} />
				</View>
			</View>
			<FlatList
				testID="runs-list"
				data={props.runs}
				keyExtractor={run => run.id}
				ListHeaderComponent={composer}
				ListEmptyComponent={
					<Text testID="runs-empty" style={styles.empty}>
						No runs yet.
					</Text>
				}
				renderItem={({ item }) => (
					<View testID={"run-" + item.id} style={styles.runRow}>
						<Text style={styles.runTitle}>{item.title}</Text>
						<Text style={styles.runState}>{item.state}</Text>
					</View>
				)}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1 },
	toolbar: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 16,
		paddingVertical: 12,
	},
	toolbarRight: { flexDirection: "row", alignItems: "center", gap: 8 },
	title: { fontSize: 24, fontWeight: "600" },
	status: { fontSize: 12, opacity: 0.6 },
	composer: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
	section: { fontSize: 13, opacity: 0.6, marginTop: 8 },
	input: {
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: "#888",
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 10,
		fontSize: 16,
	},
	actions: { marginTop: 8, alignItems: "flex-start" },
	error: { color: "#c62828", marginTop: 8 },
	empty: { paddingHorizontal: 16, paddingVertical: 12, opacity: 0.6 },
	runRow: {
		paddingHorizontal: 16,
		paddingVertical: 10,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: "#ccc",
	},
	runTitle: { fontSize: 16, fontWeight: "600" },
	runState: { fontSize: 12, opacity: 0.6 },
});
